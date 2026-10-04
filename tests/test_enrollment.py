import json
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi.testclient import TestClient

from job_intel_tracker import enrollment
from job_intel_tracker.app import create_app


def setup(tmp_path, monkeypatch):
    tmp_path.chmod(0o700)
    for key in ("APPLE_OWNER_SUB", "TRACKER_DEMO"):
        monkeypatch.delenv(key, raising=False)
    for key, value in {
        "APPLE_ENROLLMENT_ENABLED": "1",
        "APPLE_CLIENT_ID": "fixture-client",
        "APPLE_REDIRECT_URI": "https://tracker.example/auth/callback",
        "APPLE_OWNER_SUB_FILE": str(tmp_path / "owner.json"),
        "APPLE_TEAM_ID": "fixture-team",
        "APPLE_KEY_ID": "fixture-key",
        "APPLE_PRIVATE_KEY_FILE": str(tmp_path / "key.p8"),
    }.items():
        monkeypatch.setenv(key, value)
    key = ec.generate_private_key(ec.SECP256R1())
    (tmp_path / "key.p8").write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    )
    app = create_app(tmp_path)
    monkeypatch.setattr(enrollment.secrets, "token_urlsafe", lambda n: "inert-capability-" + "x" * 32)
    enrollment.begin(tmp_path, tmp_path / "code.json")
    return app, TestClient(app, base_url="https://tracker.example")


def test_verified_candidate_requires_local_approval_and_restart(tmp_path, monkeypatch):
    app, client = setup(tmp_path, monkeypatch)
    code = json.loads((tmp_path / "code.json").read_text())["code"]
    assert client.get("/api/records").status_code == 401
    assert client.post("/auth/enroll/start", data={"code": code}).status_code == 401
    start = client.post(
        "/auth/enroll/start", headers={"Origin": "https://tracker.example"}, data={"code": code}, follow_redirects=False
    )
    assert start.status_code == 303
    values = parse_qs(urlparse(start.headers["location"]).query)
    state, nonce = values["state"][0], values["nonce"][0]
    assert (
        client.post(
            "/auth/enroll/start", headers={"Origin": "https://tracker.example"}, data={"code": code}
        ).status_code
        == 401
    )
    other = TestClient(app, base_url="https://tracker.example")
    assert other.post("/auth/callback", data={"state": state, "code": "fixture-code"}).status_code == 401
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode(
        {
            "iss": enrollment.ISSUER,
            "aud": "fixture-client",
            "sub": "inert-owner-sub",
            "nonce": nonce,
            "iat": int(time.time()),
            "exp": int(time.time()) + 60,
        },
        private,
        algorithm="RS256",
    )
    from job_intel_tracker import app as module

    class FakeHTTP:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, data):
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"id_token": token})

    monkeypatch.setattr(module.httpx, "AsyncClient", FakeHTTP)
    monkeypatch.setattr(
        module.jwt,
        "PyJWKClient",
        lambda url: SimpleNamespace(get_signing_key_from_jwt=lambda token: SimpleNamespace(key=private.public_key())),
    )
    result = client.post("/auth/callback", data={"state": state, "code": "fixture-code"})
    assert result.status_code == 200 and "inert-owner-sub" not in result.text
    assert "session=" not in result.headers.get("set-cookie", "")
    assert client.get("/api/records").status_code == 401
    assert client.post("/auth/callback", data={"state": state, "code": "fixture-code"}).status_code == 401
    review = tmp_path / "review.json"
    enrollment.review(tmp_path, review)
    with pytest.raises(ValueError):
        enrollment.approve(tmp_path, review)
    enrollment.approve(tmp_path, review, True)
    assert (tmp_path / "owner.json").stat().st_mode & 0o777 == 0o600
    assert client.get("/auth/enroll").status_code == 404
    assert client.get("/auth/apple").status_code == 503
    restarted = TestClient(create_app(tmp_path), base_url="https://tracker.example")
    assert restarted.get("/auth/apple", follow_redirects=False).status_code == 307
    assert restarted.get("/api/records").status_code == 401
    with pytest.raises(ValueError):
        enrollment.begin(tmp_path, tmp_path / "other.json")


def test_cancel_expiry_config_and_private_file_guards(tmp_path, monkeypatch):
    app, c = setup(tmp_path, monkeypatch)
    enrollment.cancel(tmp_path)
    assert (
        c.post(
            "/auth/enroll/start",
            headers={"Origin": "https://tracker.example"},
            data={"code": "inert-capability-" + "x" * 32},
        ).status_code
        == 401
    )
    enrollment.begin(tmp_path, tmp_path / "new.json")
    with app.state.db() as db:
        db.execute("UPDATE owner_enrollment SET expires=0")
    assert (
        c.post(
            "/auth/enroll/start",
            headers={"Origin": "https://tracker.example"},
            data={"code": "inert-capability-" + "x" * 32},
        ).status_code
        == 401
    )
    (tmp_path / "owner.json").write_text("{}")
    (tmp_path / "owner.json").chmod(0o600)
    assert c.get("/auth/enroll").status_code == 404
    with pytest.raises(RuntimeError):
        create_app(tmp_path)
    with pytest.raises(FileExistsError):
        enrollment.write_private(tmp_path, tmp_path / "owner.json", {})


def test_concurrent_one_time_code_and_cancelled_callback(tmp_path, monkeypatch):
    app, _ = setup(tmp_path, monkeypatch)
    code = "inert-capability-" + "x" * 32

    def consume(_):
        c = TestClient(app, base_url="https://tracker.example")
        return c.post(
            "/auth/enroll/start",
            headers={"Origin": "https://tracker.example"},
            data={"code": code},
            follow_redirects=False,
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(consume, range(2))) == [303, 401]
    enrollment.cancel(tmp_path)
    with app.state.db() as db:
        assert db.execute("SELECT phase FROM owner_enrollment").fetchone()[0] == "cancelled"


def test_candidate_binding_expiry_and_approval_race(tmp_path, monkeypatch):
    app, _ = setup(tmp_path, monkeypatch)
    with app.state.db() as db:
        db.execute(
            "UPDATE owner_enrollment SET phase='candidate',candidate_sub='inert-owner-sub',expires=?",
            (time.time() + 300,),
        )
    review = tmp_path / "review.json"
    enrollment.review(tmp_path, review)
    monkeypatch.setenv("APPLE_CLIENT_ID", "different-client")
    with pytest.raises(ValueError):
        enrollment.approve(tmp_path, review, True)
    monkeypatch.setenv("APPLE_CLIENT_ID", "fixture-client")
    with app.state.db() as db:
        db.execute("UPDATE owner_enrollment SET expires=0")
    with pytest.raises(ValueError):
        enrollment.approve(tmp_path, review, True)
    with app.state.db() as db:
        db.execute("UPDATE owner_enrollment SET expires=?", (time.time() + 300,))
    newer = tmp_path / "new-review.json"
    enrollment.review(tmp_path, newer)

    def approve(_):
        try:
            enrollment.approve(tmp_path, newer, True)
            return True
        except (ValueError, OSError):
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(approve, range(2))) == [False, True]
    with pytest.raises(ValueError):
        enrollment.cancel(tmp_path)


def test_deleted_board_remnants_prevent_enrollment(tmp_path, monkeypatch):
    app, _ = setup(tmp_path, monkeypatch)
    enrollment.cancel(tmp_path)
    with app.state.db() as db:
        db.execute("INSERT INTO idem VALUES('fixture','deleted-job','fixture','private-remnant-fixture')")
    with pytest.raises(ValueError):
        enrollment.begin(tmp_path, tmp_path / "new.json")
    assert not (tmp_path / "new.json").exists()


def test_explicit_public_origin_behind_http_proxy(tmp_path, monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://tracker.example")
    app, _ = setup(tmp_path, monkeypatch)
    c = TestClient(app, base_url="http://tracker.example")
    code = "inert-capability-" + "x" * 32
    assert c.get("/static", follow_redirects=False).headers["location"] == "https://tracker.example/static/"
    for origin in (None, "https://evil.example", "http://tracker.example"):
        headers = {"X-Forwarded-Proto": "https", "X-Forwarded-Host": "tracker.example"}
        if origin:
            headers["Origin"] = origin
        assert c.post("/auth/enroll/start", headers=headers, data={"code": code}).status_code == 401
    bad = TestClient(app, base_url="http://evil.example")
    assert (
        bad.post(
            "/auth/enroll/start",
            headers={"Origin": "https://tracker.example", "X-Forwarded-Host": "tracker.example"},
            data={"code": code},
        ).status_code
        == 421
    )
    assert bad.get("/healthz").status_code == 200
    r = c.post(
        "/auth/enroll/start",
        headers={"Origin": "https://tracker.example", "X-Forwarded-Proto": "http"},
        data={"code": code},
        follow_redirects=False,
    )
    assert r.status_code == 303 and "Secure" in r.headers["set-cookie"]
    assert c.get("/api/records").status_code == 401
    # Owner writes still require CSRF and exact HTTPS Origin behind the proxy.
    with app.state.db() as db:
        from job_intel_tracker.enrollment import digest

        db.execute("INSERT INTO sessions VALUES(?,?,?)", (digest("inert-session"), "inert-csrf", time.time() + 60))
    headers = {"Cookie": "session=inert-session", "Origin": "https://tracker.example", "X-CSRF-Token": "inert-csrf"}
    assert c.post("/auth/logout", headers={**headers, "Origin": "https://evil.example"}).status_code == 403
    assert c.post("/auth/logout", headers={**headers, "X-CSRF-Token": "wrong"}).status_code == 403
    assert c.post("/auth/logout", headers=headers).status_code == 200


@pytest.mark.parametrize(
    "origin",
    [
        "http://tracker.example",
        "https://user@tracker.example",
        "https://tracker.example/path",
        "https://tracker.example?query=1",
    ],
)
def test_invalid_public_origin_refuses_startup(tmp_path, monkeypatch, origin):
    monkeypatch.setenv("PUBLIC_BASE_URL", origin)
    with pytest.raises(RuntimeError):
        create_app(tmp_path)
