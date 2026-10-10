"""Offline SQLite to empty PostgreSQL migration. Never runs automatically.

Stop all app, agent and outbox writers first. Preserve a backup before executing.
Source is opened read-only. Credentials keep their scopes; browser/mobile sessions
and pending authentication/enrollment capabilities are intentionally discarded.
"""

import argparse
import os
import shutil
import sqlite3
from pathlib import Path

from . import database

TABLES = (
    "records",
    "revisions",
    "audit",
    "tokens",
    "idem",
    "attachments",
    "research_requests",
    "research_events",
    "research_outbox",
    "research_deliveries",
)


def validate_source_version(src):
    """Reject unknown versioned sources before creating files or opening a target."""
    marker = src.execute("SELECT type FROM sqlite_master WHERE name='schema_migrations'").fetchone()
    if marker is None:
        return  # supported pre-versioned SQLite database
    if marker[0] != "table":
        raise ValueError("Unsupported SQLite source schema version")
    columns = src.execute("PRAGMA table_info(schema_migrations)").fetchall()
    if len(columns) != 1 or columns[0][1:3] != ("version", "INTEGER") or columns[0][5] != 1:
        raise ValueError("Unsupported SQLite source schema version")
    versions = [row[0] for row in src.execute("SELECT version FROM schema_migrations")]
    if versions != [1]:
        raise ValueError("Unsupported SQLite source schema version")


def migrate(source: Path, destination: Path, *, confirmed=False):
    if not confirmed or not os.getenv("DATABASE_URL"):
        raise ValueError("Explicit stopped-source/empty-target confirmation and PostgreSQL DATABASE_URL required")
    source = source.resolve()
    destination = destination.resolve()
    if destination.exists() or destination.is_relative_to(source):
        raise ValueError("Destination must be new and outside the SQLite source directory")
    path = source / "tracker.sqlite3"
    if not path.is_file() or path.is_symlink():
        raise ValueError("Source must be an existing regular SQLite database")
    # URI read-only prevents accidentally creating or modifying a source database.
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as src:
        src.execute("BEGIN")
        if src.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Source integrity check failed")
        validate_source_version(src)
        destination.mkdir(mode=0o700, parents=True)
        db = database.factory(destination)
        database.initialize(db)
        with db() as target:
            target.execute("BEGIN IMMEDIATE")
            # Include auth tables in the empty-target check, never overwrite a board.
            for table in (
                *TABLES,
                "sessions",
                "flows",
                "google_flows",
                "mobile_flows",
                "mobile_sessions",
                "mobile_apple_flows",
                "mobile_providers",
                "owner_enrollment",
            ):
                if target.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]:
                    raise ValueError("PostgreSQL target is not empty")
            for table in TABLES:
                if not src.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                    continue  # pre-mobile/pre-queue SQLite database
                columns = [row[1] for row in src.execute(f"PRAGMA table_info({table})")]
                # Columns must match the initialized target, never interpolate source SQL.
                expected = [column.name for column in target.execute(f"SELECT * FROM {table} LIMIT 0").description]
                if columns != expected:
                    raise ValueError("Source schema differs from the supported migration schema")
                rows = src.execute(f"SELECT * FROM {table}").fetchall()
                target.executemany(f"INSERT INTO {table} VALUES({','.join('?' for _ in columns)})", rows)
                if target.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] != len(rows):
                    raise ValueError("Migration count mismatch")
            target.execute(
                "SELECT setval(pg_get_serial_sequence('audit','id'), COALESCE(MAX(id),0)+1, false) FROM audit"
            )
            shutil.copytree(source / "uploads", destination / "uploads")
        return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--destination-dir", type=Path, required=True)
    parser.add_argument("--confirm-stopped-source-and-empty-target", action="store_true")
    args = parser.parse_args()
    try:
        migrate(args.source_dir, args.destination_dir, confirmed=args.confirm_stopped_source_and_empty_target)
    except (ValueError, OSError, *database.ERRORS):
        parser.exit(
            1,
            "Migration refused or failed; inspect the private target and retained source. No credentials are logged.\n",
        )
    print("Offline migration completed. Point DATA_DIR to the new uploads directory; sign in again.")


if __name__ == "__main__":
    main()
