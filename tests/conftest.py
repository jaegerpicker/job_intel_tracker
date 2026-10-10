"""Optional full-suite PostgreSQL parity, one fresh schema per temporary data root.

Only TEST_POSTGRES_URL is accepted. Use an isolated disposable database owned by
the test operator; schemas created here have random names and are removed on exit.
Demo's SQLite-only production policy is overridden solely inside this fixture.
"""

import os
import uuid

import pytest


def pytest_addoption(parser):
    parser.addoption("--postgres", action="store_true", help="Run database-backed tests on isolated PostgreSQL schemas")


@pytest.fixture(autouse=True)
def postgres_backend(request, monkeypatch):
    if not request.config.getoption("--postgres"):
        yield
        return
    url = os.getenv("TEST_POSTGRES_URL")
    if not url:
        pytest.fail("--postgres requires an explicit disposable TEST_POSTGRES_URL")
    import psycopg
    from psycopg import sql

    from job_intel_tracker import database

    original = database.factory
    schemas = {}

    def isolated(root, *, demo=False):
        identity = str(root.resolve())
        if identity not in schemas:
            schema = "fieldnotes_test_" + uuid.uuid4().hex
            with psycopg.connect(url, autocommit=True) as connection:
                connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
            schemas[identity] = schema
        from urllib.parse import quote

        separator = "&" if "?" in url else "?"
        monkeypatch.setenv("DATABASE_URL", url + separator + "options=" + quote("-c search_path=" + schemas[identity]))
        return original(root, demo=False)

    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setattr(database, "factory", isolated)
    yield
    with psycopg.connect(url, autocommit=True) as connection:
        for schema in schemas.values():
            connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
