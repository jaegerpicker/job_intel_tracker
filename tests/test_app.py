import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from job_intel_tracker.app import create_app


@pytest.fixture
def env(tmp_path):
    app = create_app(tmp_path, demo=True)
    c = TestClient(app)
    assert c.post("/auth/demo").status_code == 200
    csrf = c.get("/api/me").json()["csrf"]
    c.headers["X-CSRF-Token"] = csrf

    def agent(name, scopes, jobs=None):
        # Inert test credentials only; issuance in demo is intentionally disabled.
        token = "inert-test-fixture-" + name
        with app.state.db() as db:
            db.execute(
                "INSERT INTO tokens VALUES(?,?,?,?,?,0)",
                (
                    hashlib.sha256(token.encode()).hexdigest(),
                    name,
                    json.dumps(scopes),
                    json.dumps(jobs or []),
                    time.time() + 60,
                ),
            )
        a = TestClient(app)
        a.headers["Authorization"] = "Bearer " + token
        return a

    return app, c, agent


def put(c, rid="job1", kind="job", job=None, version=0, body=None, key=None):
    return c.put(
        "/api/records/" + rid,
        headers={"Idempotency-Key": key or rid + str(version)},
        json={
            "kind": kind,
            "job": job,
            "version": version,
            "body": body or {"title": "Example Engineer", "company": "Example Only", "stage": "Applied"},
        },
    )


def test_auth_csrf_fail_closed(env, tmp_path, monkeypatch):
    app, c, _ = env
    anon = TestClient(app)
    for url in ["/api/records", "/api/export", "/api/audit", "/api/agents", "/api/schema", "/api/policy"]:
        assert anon.get(url).status_code == 401
    assert put(anon).status_code == 401
    c.headers.pop("X-CSRF-Token")
    assert put(c).status_code == 403
    assert c.post("/api/agents", json={"name": "Eva", "scopes": ["read"]}).status_code == 403
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(RuntimeError):
        create_app(tmp_path, demo=True)
    production = TestClient(create_app(tmp_path / "prod"))
    assert production.post("/auth/demo").status_code == 403
    assert production.get("/auth/apple").status_code == 503
    monkeypatch.setenv("APPLE_CLIENT_ID", "inert-service")
    monkeypatch.setenv("APPLE_OWNER_SUB", "inert-sub")
    assert production.get("/auth/info").json()["configured"] is False
    assert production.get("/auth/apple").status_code == 503


def test_versions_idempotency_audit(env):
    _, c, _ = env
    assert put(c, key="one").status_code == 200
    assert put(c, key="one").json()["version"] == 1
    assert put(c, key="two").status_code == 409
    assert put(c, key="one", body={"title": "Changed", "company": "Example", "stage": "Applied"}).status_code == 409
    assert len(c.get("/api/audit").json()) == 1
    assert (
        put(c, version=1, body={"title": "Engineer", "company": "Example", "stage": "Interview"}).json()["body"][
            "timeline"
        ][-1]["stage"]
        == "Interview"
    )
    assert c.delete("/api/records/job1?version=1").status_code == 409


def test_agent_isolation_scope_revoke_state(env):
    _, c, agent = env
    put(c)
    eva = agent("Eva", ["read", "contribute", "jobs:write"], ["job1"])
    hana = agent("Hana", ["read", "contribute"])
    readonly = agent("Muse", ["read"])
    body = {"score": 85, "rationale": "Synthetic fit", "rubric": "Technical depth", "evidence": "Synthetic fixture"}
    assert put(eva, "rating1", "rating", "job1", body=body).status_code == 200
    assert put(hana, "rating1", "rating", "job1", 1, body).status_code == 403
    assert put(readonly, "note1", "note", "job1", body={"text": "fixture"}).status_code == 403
    assert (
        put(
            eva, version=1, body={"title": "Example Engineer", "company": "Example Only", "stage": "Interview"}
        ).status_code
        == 200
    )
    assert put(eva, "filters", "filters", body={"active_cap": 10}).status_code in (403, 422)
    assert eva.get("/api/export").status_code == 403
    put(c, "job2", body={"title": "Other", "company": "Other Synthetic", "stage": "Prospect"})
    assert len(eva.get("/api/records?kind=job").json()) == 1
    assert eva.get("/api/jobs/job2/attachments").status_code == 403
    assert c.delete("/api/agents/Eva").status_code == 200
    assert eva.get("/api/records").status_code == 401


def test_attachment_write_only_does_not_grant_listing_or_binary_read(env):
    _, owner, agent = env
    put(owner)
    writer = agent("SyntheticUploader", ["read", "contribute", "jobs:write", "attachments:write"])
    uploaded = writer.post(
        "/api/jobs/job1/attachments",
        headers={"Idempotency-Key": "synthetic-upload-only"},
        files={"file": ("synthetic-cover-letter.pdf", b"%PDF-inert-fixture", "application/pdf")},
    )
    assert uploaded.status_code == 200
    aid = uploaded.json()["id"]
    assert writer.get("/api/jobs/job1/attachments").status_code == 403
    assert writer.get("/api/attachments/" + aid).status_code == 403
    assert owner.get("/api/attachments/" + aid).status_code == 200
    replay = writer.post(
        "/api/jobs/job1/attachments",
        headers={"Idempotency-Key": "synthetic-upload-only"},
        files={"file": ("synthetic-cover-letter.pdf", b"%PDF-inert-fixture", "application/pdf")},
    )
    assert replay.json() == uploaded.json()
    assert owner.delete("/api/agents/SyntheticUploader").status_code == 200
    assert (
        writer.post(
            "/api/jobs/job1/attachments",
            headers={"Idempotency-Key": "synthetic-revoked-upload"},
            files={"file": ("synthetic.pdf", b"%PDF-inert-fixture", "application/pdf")},
        ).status_code
        == 401
    )


def test_upload_download_authorization_versions(env):
    app, c, agent = env
    put(c)
    assert (
        c.post(
            "/api/jobs/job1/attachments",
            headers={"Idempotency-Key": str(time.time_ns())},
            files={"file": ("bad.html", b"<script>", "text/html")},
        ).status_code
        == 422
    )
    assert (
        c.post(
            "/api/jobs/job1/attachments",
            headers={"Idempotency-Key": str(time.time_ns())},
            files={"file": ("bad.pdf", b"bad", "application/pdf")},
        ).status_code
        == 422
    )
    a = c.post(
        "/api/jobs/job1/attachments",
        headers={"Idempotency-Key": str(time.time_ns())},
        files={"file": ("../../resume.txt", b"synthetic only", "text/plain")},
    ).json()
    assert a["filename"] == "resume.txt"
    b = c.post(
        "/api/jobs/job1/attachments",
        headers={"Idempotency-Key": str(time.time_ns())},
        files={"file": ("resume.txt", b"v2 synthetic", "text/plain")},
    ).json()
    assert b["version"] == 2
    aid = a["id"]
    assert TestClient(app).get("/api/attachments/" + aid).status_code == 401
    limited = agent("Other", ["read"], ["job2"])
    assert limited.get("/api/attachments/" + aid).status_code == 403
    response = c.get("/api/attachments/" + aid)
    assert response.content == b"synthetic only"
    assert "attachment" in response.headers["content-disposition"]
    assert c.delete("/api/records/job1?version=1").status_code == 200
    assert c.get("/api/attachments/" + aid).status_code == 404


def test_concurrent_writes(env):
    _, c, _ = env
    put(c)

    def write(i):
        return put(
            c,
            version=1,
            body={"title": f"Synthetic {i}", "company": "Example", "stage": "Interview"},
            key=f"parallel-{i}",
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(write, range(2))) == [200, 409]


def test_provenance_and_policy(env):
    _, c, _ = env
    put(c)
    assert put(c, "research", "research", "job1", body={"text": "claim"}).status_code == 422
    assert (
        put(
            c,
            "research",
            "research",
            "job1",
            body={"text": "claim", "source": "https://example.com", "observed_at": "2026-01-01"},
        ).status_code
        == 200
    )
    assert c.get("/api/policy").json()["body"]["base_floor"] == 220000
    assert c.get("/api/schema").json()["info"]["title"] == "job_intel_tracker"
    assert c.post("/auth/demo", headers={"Origin": "https://evil.example"}).status_code == 403


def test_capacity_atomic_and_primary_employer(env):
    _, c, _ = env
    p = c.get("/api/policy").json()["body"]
    p["active_cap"] = 1
    assert put(c, "search-policy", "filters", body=p).status_code == 200

    def create(i):
        return put(
            c, f"capacity-{i}", body={"title": "Example", "company": f"Synthetic {i}", "stage": "Applied"}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(create, range(2))) == [200, 409]
    assert len([x for x in c.get("/api/records?kind=job").json()]) == 1
    job = c.get("/api/records?kind=job").json()[0]
    assert put(c, "duplicate", body=job["body"]).status_code == 409
    alt = {**job["body"], "primary_id": job["id"], "title": "Alternative title"}
    assert put(c, "alternative", body=alt).status_code == 200


def test_agent_expiry_owner_fields_and_upload_retry(env):
    app, c, agent = env
    put(c)
    eva = agent("Eva", ["read", "jobs:write", "attachments:write", "attachments:read"])
    b = c.get("/api/records?kind=job").json()[0]["body"]
    b["grandfathered"] = True
    b["exception_reason"] = "Owner-only fixture"
    assert put(eva, version=1, body=b).status_code == 403
    a = eva.post(
        "/api/jobs/job1/attachments",
        headers={"Idempotency-Key": "same-upload"},
        files={"file": ("fixture.txt", b"only synthetic")},
    )
    assert a.status_code == 200
    again = eva.post(
        "/api/jobs/job1/attachments",
        headers={"Idempotency-Key": "same-upload"},
        files={"file": ("fixture.txt", b"only synthetic")},
    )
    assert again.json() == a.json()
    with app.state.db() as db:
        db.execute("UPDATE tokens SET expires=0 WHERE name=?", ("Eva",))
    assert eva.get("/api/records").status_code == 401


def test_apple_protocol_signed_jwt(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from urllib.parse import parse_qs, urlparse

    import jwt
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec, rsa

    from job_intel_tracker import app as module

    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ec_key = ec.generate_private_key(ec.SECP256R1())
    keypath = tmp_path / "inert-test-signing.pem"
    keypath.write_bytes(
        ec_key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
    )
    for k, v in {
        "APPLE_CLIENT_ID": "test-service",
        "APPLE_REDIRECT_URI": "https://tracker.example/auth/callback",
        "APPLE_OWNER_SUB": "inert-owner-sub",
        "APPLE_TEAM_ID": "inert-team",
        "APPLE_KEY_ID": "inert-key",
        "APPLE_PRIVATE_KEY_FILE": str(keypath),
    }.items():
        monkeypatch.setenv(k, v)
    app = create_app(tmp_path / "prod")
    c = TestClient(app, base_url="https://tracker.example")
    response = c.get("/auth/apple", follow_redirects=False)
    assert "Secure" in response.headers["set-cookie"] and "SameSite=none" in response.headers["set-cookie"]
    values = parse_qs(urlparse(response.headers["location"]).query)
    state, nonce = values["state"][0], values["nonce"][0]
    claims = {
        "iss": "https://appleid.apple.com",
        "aud": "test-service",
        "sub": "inert-owner-sub",
        "nonce": nonce,
        "iat": int(time.time()),
        "exp": int(time.time()) + 60,
    }
    signed = jwt.encode(claims, private, algorithm="RS256", headers={"kid": "fixture"})

    class FakeHTTP:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, data):
            assert url == "https://appleid.apple.com/auth/token"
            assert data["grant_type"] == "authorization_code"
            assert data["code"] == "inert-code"
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"id_token": signed})

    monkeypatch.setattr(module.httpx, "AsyncClient", FakeHTTP)
    monkeypatch.setattr(
        module.jwt,
        "PyJWKClient",
        lambda url: SimpleNamespace(get_signing_key_from_jwt=lambda token: SimpleNamespace(key=private.public_key())),
    )
    assert c.post("/auth/callback", data={"state": "wrong", "code": "inert-code"}).status_code == 401
    result = c.post("/auth/callback", data={"state": state, "code": "inert-code"}, follow_redirects=False)
    assert result.status_code == 303
    assert "Secure" in result.headers["set-cookie"] and "HttpOnly" in result.headers["set-cookie"]
    assert c.get("/api/me").status_code == 200
    assert c.post("/auth/callback", data={"state": state, "code": "inert-code"}).status_code == 401
    # Every attack obtains a fresh one-time state; JWT signature validation remains real.
    for change in [
        {"sub": "other-owner"},
        {"nonce": "wrong"},
        {"aud": "wrong"},
        {"iss": "https://evil.example"},
        {"exp": 0},
    ]:
        r = c.get("/auth/apple", follow_redirects=False)
        values = parse_qs(urlparse(r.headers["location"]).query)
        signed = jwt.encode({**claims, "nonce": values["nonce"][0], **change}, private, algorithm="RS256")
        assert c.post("/auth/callback", data={"state": values["state"][0], "code": "inert-code"}).status_code == 401
    r = c.get("/auth/apple", follow_redirects=False)
    values = parse_qs(urlparse(r.headers["location"]).query)
    signed = jwt.encode(
        {**claims, "nonce": values["nonce"][0]},
        rsa.generate_private_key(public_exponent=65537, key_size=2048),
        algorithm="RS256",
    )
    assert c.post("/auth/callback", data={"state": values["state"][0], "code": "inert-code"}).status_code == 401


def test_parent_job_cannot_bypass_scope_and_owner_fields(env):
    _, c, agent = env
    put(c)
    a = agent("Scoped", ["read", "jobs:write"], ["job1"])
    assert put(a, "forbidden", job="job1").status_code == 422
    assert put(a, "forbidden").status_code == 403
    unrestricted = agent("Writer", ["jobs:write"])
    for field, value in [
        ("exception_reason", "spoofed exception"),
        ("grandfathered", True),
        ("owner_assessment", "spoofed decision"),
    ]:
        assert (
            put(
                unrestricted,
                "new-" + field,
                body={
                    "title": "Synthetic",
                    "company": field,
                    "stage": "Prospect",
                    **({"exception_reason": "fixture"} if field == "grandfathered" else {}),
                    field: value,
                },
            ).status_code
            == 403
        )


def test_backup_restore_and_mcp(env, tmp_path):
    import httpx

    from job_intel_tracker.backup import backup, restore
    from job_intel_tracker.mcp import call_tool

    _app, c, _ = env
    put(c)
    file = c.post(
        "/api/jobs/job1/attachments",
        headers={"Idempotency-Key": "backup-upload"},
        files={"file": ("fixture.txt", b"Synthetic backup")},
    ).json()
    source = tmp_path
    destination = tmp_path.parent / (tmp_path.name + "-backup")
    backup(source, destination)
    restored = tmp_path.parent / (tmp_path.name + "-restored")
    restore(destination, restored)
    assert (restored / "uploads" / file["id"]).read_bytes() == b"Synthetic backup"
    rc = TestClient(create_app(restored, demo=True))
    assert rc.get("/api/records").status_code == 401
    rc.post("/auth/demo")
    assert len(rc.get("/api/records").json()) == 1
    with pytest.raises(ValueError):
        restore(destination, restored)

    def transport(request):
        if request.url.path == "/api/policy":
            return httpx.Response(200, json={"body": {"active_cap": 10}})
        return httpx.Response(403, json={"detail": "Scope denied"})

    with httpx.Client(base_url="https://tracker.example", transport=httpx.MockTransport(transport)) as mc:
        assert not call_tool(mc, "get_policy", {}).get("isError")
        assert call_tool(
            mc, "write_record", {"id": "job", "kind": "job", "body": {}, "version": 0, "idempotency_key": "fixture"}
        )["isError"]


def test_owner_credential_lifecycle_with_inert_fixture(tmp_path, monkeypatch):
    from job_intel_tracker import app as module

    app = create_app(tmp_path)
    c = TestClient(app, base_url="https://tracker.example")
    raw = "inert-owner-session-fixture"
    with app.state.db() as db:
        db.execute(
            "INSERT INTO sessions VALUES(?,?,?)",
            (hashlib.sha256(raw.encode()).hexdigest(), "inert-csrf-fixture", time.time() + 60),
        )
    c.cookies.set("session", raw)
    c.headers["X-CSRF-Token"] = "inert-csrf-fixture"
    monkeypatch.setattr(module.secrets, "token_urlsafe", lambda size: "inert-lifecycle-token-fixture")
    issued = c.post("/api/agents", json={"name": "Eva", "scopes": ["read"], "jobs": ["fixture-job"], "days": 1})
    assert issued.status_code == 200
    assert issued.json()["token"] == "inert-lifecycle-token-fixture"
    with app.state.db() as db:
        token = db.execute("SELECT * FROM tokens").fetchone()
        assert token["hash"] == hashlib.sha256(b"inert-lifecycle-token-fixture").hexdigest()
        assert token["hash"] != "inert-lifecycle-token-fixture"
    assert "inert-lifecycle-token-fixture" not in c.get("/api/agents").text
    duplicate = c.post("/api/agents", json={"name": "Eva", "scopes": ["read", "jobs:write"]})
    assert duplicate.status_code == 409
    assert "token" not in duplicate.json()
    for invalid_name in ("Name with spaces", "1invalid", "", "a" * 41):
        rejected = c.post("/api/agents", json={"name": invalid_name, "scopes": ["read"]})
        assert rejected.status_code == 422
        assert "token" not in rejected.json()
    listed = c.get("/api/agents").json()
    assert len(listed) == 1 and json.loads(listed[0]["scopes"]) == ["read"]
    assert c.post("/api/agents", json={"name": "owner", "scopes": ["read"]}).status_code == 422
    assert c.post("/api/agents", json={"name": "Hana", "scopes": ["admin"]}).status_code == 422
    assert c.post("/api/agents", json={"name": "Hana", "scopes": ["read"], "days": 91}).status_code == 422
    agent = TestClient(app)
    agent.headers["Authorization"] = "Bearer inert-lifecycle-token-fixture"
    assert agent.get("/api/policy").status_code == 200
    assert c.delete("/api/agents/Eva").status_code == 200
    assert c.post("/api/agents", json={"name": "Eva", "scopes": ["read"]}).status_code == 409
    assert len(c.get("/api/agents").json()) == 1
    assert agent.get("/api/policy").status_code == 401
