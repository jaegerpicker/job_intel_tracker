"""Schema adoption, rollback, demo isolation and offline migration checks."""

import hashlib
import sqlite3
import time

import pytest

from job_intel_tracker import database
from job_intel_tracker.app import create_app


def test_existing_schema_upgrade_preserves_data(tmp_path):
    # Older SQLite schema lacks a migration marker and newer auth/queue tables.
    with sqlite3.connect(tmp_path / "tracker.sqlite3") as c:
        c.executescript(database.BASE_TABLES)
        c.execute(
            "INSERT INTO records VALUES('legacy','job',NULL,'owner',1,?,?)",
            ('{"title":"Synthetic","company":"Fixture","stage":"Applied"}', time.time()),
        )
        c.execute("INSERT INTO tokens VALUES('inert-hash','Agent','[\"read\"]','[]',9999999999,0)")
    with database.factory(tmp_path)() as probe:
        if probe.postgres:
            pytest.skip("Legacy SQLite adoption is exercised by the SQLite run")
    app = create_app(tmp_path)
    for _ in range(2):
        database.initialize(app.state.db)
    with app.state.db() as c:
        assert c.execute("SELECT version FROM schema_migrations").fetchone()[0] == 1
        assert c.execute("SELECT author FROM records WHERE id='legacy'").fetchone()[0] == "owner"
        assert c.execute("SELECT scopes FROM tokens WHERE name='Agent'").fetchone()[0] == '["read"]'


def test_transaction_rollback_and_newer_schema_refusal(tmp_path):
    app = create_app(tmp_path)
    with pytest.raises(ValueError), app.state.db() as c:
        c.execute("BEGIN IMMEDIATE")
        c.execute("INSERT INTO audit(actor) VALUES('synthetic')")
        raise ValueError("force rollback")
    with app.state.db() as c:
        assert c.execute("SELECT COUNT(*) FROM audit").fetchone()[0] == 0
        c.execute("INSERT INTO schema_migrations VALUES(999)")
    with pytest.raises(RuntimeError, match="newer"):
        create_app(tmp_path)


def test_demo_ignores_postgres_configuration(tmp_path, monkeypatch, request):
    if request.config.getoption("--postgres"):
        pytest.skip("Parity fixture overrides demo backend solely for testing")
    monkeypatch.setenv("DATABASE_URL", "postgresql://invalid:invalid@invalid.invalid/never-connect")
    app = create_app(tmp_path, demo=True)
    with app.state.db() as c:
        assert not c.postgres
        assert c.execute("SELECT COUNT(*) FROM records").fetchone()[0] == 0


def test_offline_migration_preserves_history_credentials_and_files(tmp_path, request, monkeypatch):
    if not request.config.getoption("--postgres"):
        pytest.skip("Requires --postgres and disposable TEST_POSTGRES_URL")
    from job_intel_tracker.migrate import migrate

    source = tmp_path / "source"
    source.mkdir(mode=0o700)
    (source / "uploads").mkdir(mode=0o700)
    attachment = "a" * 32
    content = b"Synthetic attachment only"
    (source / "uploads" / attachment).write_bytes(content)
    with sqlite3.connect(source / "tracker.sqlite3") as c:
        c.executescript(database.BASE_TABLES)
        body = '{"title":"Fixture","company":"Synthetic","stage":"Applied"}'
        c.execute("INSERT INTO records VALUES('fixture','job',NULL,'owner',1,?,?)", (body, time.time()))
        c.execute("INSERT INTO revisions VALUES('fixture',1,'owner',?,?)", (body, time.time()))
        c.execute("INSERT INTO tokens VALUES('inert-hash','Agent','[\"read\"]','[]',9999999999,0)")
        c.execute(
            "INSERT INTO attachments VALUES(?,'fixture','owner','fixture.txt','text/plain',1,?)",
            (attachment, time.time()),
        )
        c.execute("INSERT INTO audit VALUES(17,'owner','write','fixture',?)", (time.time(),))
        c.execute("INSERT INTO sessions VALUES('inert-session','inert-csrf',9999999999)")
    before = hashlib.sha256((source / "tracker.sqlite3").read_bytes()).hexdigest()
    destination = tmp_path / "target"
    migrate(source, destination, confirmed=True)
    assert before == hashlib.sha256((source / "tracker.sqlite3").read_bytes()).hexdigest()
    assert (destination / "uploads" / attachment).read_bytes() == content
    db = database.factory(destination)
    with db() as c:
        assert c.execute("SELECT body FROM records").fetchone()[0] == body
        assert c.execute("SELECT version FROM revisions").fetchone()[0] == 1
        assert c.execute("SELECT scopes FROM tokens").fetchone()[0] == '["read"]'
        assert c.execute("SELECT revoked FROM tokens").fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
        c.execute("INSERT INTO audit(actor) VALUES('after-migration')")
        assert c.execute("SELECT MAX(id) FROM audit").fetchone()[0] == 18
    monkeypatch.setattr(database, "factory", lambda root: db)
    with pytest.raises(ValueError, match="not empty"):
        migrate(source, tmp_path / "another-target", confirmed=True)
    with db() as c:
        assert c.execute("SELECT COUNT(*) FROM records").fetchone()[0] == 1


def test_concurrent_agent_name_issuance_is_serialized(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    from fastapi.testclient import TestClient

    from job_intel_tracker import app as module

    app = create_app(tmp_path)
    cookie = "inert-browser-fixture"
    with app.state.db() as c:
        c.execute(
            "INSERT INTO sessions VALUES(?,?,?)",
            (hashlib.sha256(cookie.encode()).hexdigest(), "inert-csrf", time.time() + 60),
        )
    monkeypatch.setattr(module.secrets, "token_urlsafe", lambda size: "inert-token-issuance-fixture")

    def issue(_):
        client = TestClient(app, base_url="https://tracker.example")
        client.cookies.set("session", cookie)
        return client.post(
            "/api/agents", json={"name": "Race", "scopes": ["read"]}, headers={"X-CSRF-Token": "inert-csrf"}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(issue, range(2))) == [200, 409]
    with app.state.db() as c:
        assert c.execute("SELECT COUNT(*) FROM tokens").fetchone()[0] == 1
