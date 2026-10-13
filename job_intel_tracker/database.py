"""Small DB-API boundary for SQLite and optional PostgreSQL.

SQL uses positional question-mark parameters (never user-supplied SQL). PostgreSQL
writers take one transaction advisory lock, matching SQLite's single-writer
semantics for cross-record capacity, idempotency, enrollment and queue decisions.
Read transactions use repeatable snapshots. Connections always close on exit.
"""

import os
import re
import sqlite3
from pathlib import Path

try:
    import psycopg
except ImportError:
    psycopg = None  # type: ignore[assignment]

ERRORS = (sqlite3.Error,) + ((psycopg.Error,) if psycopg else ())
WRITER_LOCK = 461973810


class Row(dict):
    def __getitem__(self, key):
        return tuple(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


def row_factory(cursor):
    names = [column.name for column in (cursor.description or [])]
    return lambda values: Row(zip(names, values))


def postgres_sql(sql):
    # Explicit dialect differences in the existing schema. JSON bodies stay text
    # to preserve exports and Python validation; the queue index uses jsonb.
    sql = sql.replace("json_extract(body,'$.status')", "(body::jsonb ->> 'status')")
    if sql.lstrip().upper().startswith("CREATE TABLE"):
        sql = re.sub(r"\bREAL\b", "DOUBLE PRECISION", sql)
        sql = sql.replace("audit(id INTEGER PRIMARY KEY", "audit(id BIGSERIAL PRIMARY KEY")
    if "INSERT OR" in sql.upper() or "PRAGMA" in sql.upper() or re.search(r"\browid\b", sql, re.IGNORECASE):
        raise ValueError("Unsupported SQLite-specific SQL")
    return sql.replace("?", "%s")


class Connection:
    def __init__(self, raw, postgres):
        self.raw = raw
        self.postgres = postgres
        self.locked = False

    def __enter__(self):
        return self

    def __exit__(self, kind, value, traceback):
        try:
            self.raw.commit() if kind is None else self.raw.rollback()
        finally:
            self.raw.close()

    def execute(self, sql, parameters=()):
        statement = sql.strip().upper()
        if self.postgres:
            if statement == "BEGIN IMMEDIATE":
                self.raw.execute("BEGIN")
                self.lock()
                return self.raw.cursor()
            if statement == "BEGIN":
                return self.raw.execute("BEGIN ISOLATION LEVEL REPEATABLE READ")
            if not statement.startswith(("SELECT", "WITH", "EXPLAIN")):
                self.lock()
            return self.raw.execute(postgres_sql(sql), parameters)
        return self.raw.execute(sql, parameters)

    def lock(self):
        if not self.locked:
            self.raw.execute("SELECT pg_advisory_xact_lock(%s)", (WRITER_LOCK,))
            self.locked = True

    def executescript(self, sql):
        # Unlike sqlite executescript, retain the transaction for atomic DDL.
        for statement in sql.split(";"):
            if statement.strip():
                self.execute(statement)

    def executemany(self, sql, parameters):
        if self.postgres:
            self.lock()
            return self.raw.cursor().executemany(postgres_sql(sql), parameters)
        return self.raw.executemany(sql, parameters)

    def commit(self):
        self.raw.commit()
        self.locked = False

    def rollback(self):
        self.raw.rollback()
        self.locked = False

    def close(self):
        self.raw.close()


def factory(root: Path, *, demo=False):
    url = os.getenv("DATABASE_URL", "")
    if demo:
        # Synthetic demos always use their explicitly isolated local directory.
        url = ""
    if url and not url.startswith(("postgresql://", "postgres://")):
        raise RuntimeError("DATABASE_URL must be a PostgreSQL connection URL")
    if url and psycopg is None:
        raise RuntimeError("PostgreSQL requires the optional postgres dependency")

    def connect():
        if url:
            return Connection(psycopg.connect(url, row_factory=row_factory, connect_timeout=10), True)
        raw = sqlite3.connect(root / "tracker.sqlite3", timeout=20)
        raw.row_factory = sqlite3.Row
        raw.execute("PRAGMA foreign_keys=ON")
        return Connection(raw, False)

    return connect


def migrate(c):
    """Adopt pre-versioned databases without rewriting records or credentials."""
    c.execute("BEGIN IMMEDIATE")
    c.execute("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY)")
    versions = [row[0] for row in c.execute("SELECT version FROM schema_migrations")]
    if any(version > 1 for version in versions):
        raise RuntimeError("Database schema is newer than this service")
    c.execute("INSERT INTO schema_migrations VALUES(1) ON CONFLICT(version) DO NOTHING")


BASE_TABLES = """
        CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, job TEXT, author TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS revisions(id TEXT, version INTEGER, actor TEXT, body TEXT, timestamp REAL, PRIMARY KEY(id,version));
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor TEXT, action TEXT, resource TEXT, timestamp REAL);
        CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY, name TEXT UNIQUE, scopes TEXT, jobs TEXT, expires REAL, revoked INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, csrf TEXT, expires REAL);
        CREATE TABLE IF NOT EXISTS flows(hash TEXT PRIMARY KEY, nonce TEXT, expires REAL);
        CREATE TABLE IF NOT EXISTS idem(actor TEXT, key TEXT, digest TEXT, result TEXT, PRIMARY KEY(actor,key));
        CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, job TEXT REFERENCES records(id), author TEXT, filename TEXT, mime TEXT, version INTEGER, timestamp REAL);
        """


def initialize(db):
    from . import enrollment, google_auth, mobile_auth, research_outbox, research_queue

    with db() as c:
        migrate(c)
        for schema in (
            BASE_TABLES,
            enrollment.TABLE,
            google_auth.TABLE,
            mobile_auth.TABLES,
            research_queue.TABLES,
            research_outbox.TABLES,
        ):
            c.executescript(schema)
