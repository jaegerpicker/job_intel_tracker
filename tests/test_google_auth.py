"""Real JWT cryptography with inert codes and mocked Google transport/JWKS."""

import base64
import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from job_intel_tracker import google_auth
from job_intel_tracker.app import create_app

ORIGIN = "https://tracker.example"


@pytest.fixture
def google(tmp_path, monkeypatch):
    for key, value in {
        "GOOGLE_CLIENT_ID": "inert-google-client",
        "GOOGLE_CLIENT_SECRET": "inert-test-secret",
        "GOOGLE_REDIRECT_URI": ORIGIN + "/auth/google/callback",
        "GOOGLE_OWNER_SUB": "inert-google-owner",
        "PUBLIC_BASE_URL": ORIGIN,
        "MOBILE_AUTH_ENABLED": "1",
        "MOBILE_REDIRECT_URIS": json.dumps([ORIGIN + "/auth/mobile/callback"]),
    }.items():
        monkeypatch.setenv(key, value)
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = {"value": ""}
    exchanges = []
    authorization_challenges = {}

    class Transport:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, data):
            assert url == "https://oauth2.googleapis.com/token"
            challenge = (
                base64.urlsafe_b64encode(hashlib.sha256(data["code_verifier"].encode()).digest()).decode().rstrip("=")
            )
            assert challenge == authorization_challenges[data["code"]]
            assert data["redirect_uri"] == ORIGIN + "/auth/google/callback"
            assert data["grant_type"] == "authorization_code"
            exchanges.append(data)
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"id_token": token["value"]})

    monkeypatch.setattr(google_auth.httpx, "AsyncClient", Transport)
    monkeypatch.setattr(
        google_auth.jwt,
        "PyJWKClient",
        lambda url: SimpleNamespace(get_signing_key_from_jwt=lambda token: SimpleNamespace(key=private.public_key())),
    )
    app = create_app(tmp_path)
    client = TestClient(app, base_url=ORIGIN)

    def start(changes=None, signing_key=None, mobile_ticket=None):
        response = client.get(
            "/auth/google", params={"mobile_ticket": mobile_ticket} if mobile_ticket else {}, follow_redirects=False
        )
        assert response.status_code == 307
        values = {k: v[0] for k, v in parse_qs(urlparse(response.headers["location"]).query).items()}
        assert values["scope"] == "openid" and values["code_challenge_method"] == "S256"
        assert "Secure" in response.headers["set-cookie"] and "HttpOnly" in response.headers["set-cookie"]
        authorization_challenges["inert-test-code"] = values["code_challenge"]
        token["value"] = jwt.encode(
            {
                "iss": google_auth.ISSUER,
                "aud": "inert-google-client",
                "sub": "inert-google-owner",
                "nonce": values["nonce"],
                "iat": int(time.time()),
                "exp": int(time.time()) + 60,
                **(changes or {}),
            },
            signing_key or private,
            algorithm="RS256",
        )
        return {"state": values["state"], "code": "inert-test-code"}

    return app, client, start, exchanges


def test_success_state_replay_logout(google):
    _, client, start, exchanges = google
    assert client.get("/auth/info").json()["providers"] == {"apple": False, "google": True}
    query = start()
    assert client.get("/auth/google/callback", params={**query, "state": "wrong"}).status_code == 401
    assert not exchanges
    result = client.get("/auth/google/callback", params=query, follow_redirects=False)
    assert result.status_code == 303 and result.headers["location"] == "/"
    assert "Secure" in result.headers["set-cookie"] and "HttpOnly" in result.headers["set-cookie"]
    me = client.get("/api/me").json()
    assert me["actor"] == "owner"
    assert client.get("/auth/google/callback", params=query).status_code == 401
    assert len(exchanges) == 1
    assert client.post("/auth/logout", headers={"X-CSRF-Token": me["csrf"]}).status_code == 200
    assert client.get("/api/me").status_code == 401


@pytest.mark.parametrize(
    "changes",
    [
        {"iss": "https://evil.example"},
        {"aud": "other-client"},
        {"exp": 0},
        {"iat": int(time.time()) + 3600},
        {"nonce": "wrong"},
        {"nonce": None},
        {"sub": "other-owner", "email": "matching-owner@example.test", "email_verified": True},
        {"sub": ""},
        {"sub": 12},
        {"azp": "other-client"},
        {"aud": ["inert-google-client", "other-client"]},
    ],
)
def test_identity_failure(google, changes):
    app, client, start, _ = google
    query = start(changes)
    response = client.get("/auth/google/callback", params=query)
    assert response.status_code == 401 and response.json()["detail"] == "Identity verification failed"
    assert client.get("/api/me").status_code == 401
    with app.state.db() as c:
        assert c.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
    assert client.get("/auth/google/callback", params=query).status_code == 401


def test_bad_signature_and_missing_code(google):
    _, client, start, _ = google
    query = start(signing_key=rsa.generate_private_key(public_exponent=65537, key_size=2048))
    assert client.get("/auth/google/callback", params=query).status_code == 401
    query = start()
    assert (
        client.get("/auth/google/callback", params={"state": query["state"], "error": "access_denied"}).status_code
        == 401
    )
    assert client.get("/auth/google/callback", params=query).status_code == 401


def test_expired_and_concurrent_replay(google):
    app, client, start, exchanges = google
    query = start()
    with app.state.db() as c:
        c.execute("UPDATE google_flows SET expires=0")
    assert client.get("/auth/google/callback", params=query).status_code == 401
    assert not exchanges
    query = start()
    cookie = client.cookies.get("google_flow")

    def callback(_):
        browser = TestClient(app, base_url=ORIGIN)
        browser.cookies.set("google_flow", cookie)
        return browser.get("/auth/google/callback", params=query, follow_redirects=False).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(callback, range(2))) == [303, 401]
    assert len(exchanges) == 1


def test_native_google_handoff(google):
    app, client, start, _ = google
    import base64

    verifier = "v" * 64
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    response = client.post(
        "/auth/mobile/start",
        json={
            "redirect_uri": ORIGIN + "/auth/mobile/callback",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "client_state": "s" * 43,
            "provider": "google",
        },
    )
    ticket = parse_qs(urlparse(response.json()["authorization_url"]).query)["ticket"][0]
    redirect = client.get(response.json()["authorization_url"], follow_redirects=False)
    assert redirect.headers["location"] == "/auth/google?mobile_ticket=" + ticket
    assert client.get("/auth/apple", params={"mobile_ticket": ticket}).status_code == 401
    query = start(mobile_ticket=ticket)
    result = client.get("/auth/google/callback", params=query, follow_redirects=False)
    assert result.headers["location"] == "/auth/mobile/authorize?ticket=" + ticket
    page = client.get(result.headers["location"])
    assert "Approve mobile sign-in" in page.text
    csrf = client.get("/api/me").json()["csrf"]
    approval = client.post(
        "/auth/mobile/approve",
        data={"ticket": ticket, "csrf": csrf},
        headers={"Origin": ORIGIN},
        follow_redirects=False,
    )
    values = parse_qs(urlparse(approval.headers["location"]).query)
    payload = {"code": values["code"][0], "code_verifier": verifier, "redirect_uri": ORIGIN + "/auth/mobile/callback"}
    result = client.post("/auth/mobile/exchange", json=payload)
    assert result.status_code == 200
    assert client.post("/auth/mobile/exchange", json=payload).status_code == 401
    native = TestClient(app, base_url=ORIGIN)
    native.headers["Authorization"] = "Bearer " + result.json()["access_token"]
    assert native.get("/api/records").status_code == 200
    assert native.get("/api/agents").status_code == 403
    assert native.post("/auth/mobile/logout").status_code == 200
    assert native.get("/api/records").status_code == 401


def test_unconfigured_and_owner_file(tmp_path, monkeypatch):
    assert TestClient(create_app(tmp_path)).get("/auth/google").status_code == 503
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "inert-client")
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", ORIGIN + "/auth/google/callback")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "inert-secret")
    assert TestClient(create_app(tmp_path)).get("/auth/google").status_code == 503
    file = tmp_path / "google-owner.json"
    file.write_text(
        json.dumps(
            {
                "approved": True,
                "issuer": google_auth.ISSUER,
                "client_id": "inert-client",
                "redirect_uri": ORIGIN + "/auth/google/callback",
                "sub": "inert-sub",
            }
        )
    )
    file.chmod(0o600)
    monkeypatch.setenv("GOOGLE_OWNER_SUB_FILE", str(file))
    assert TestClient(create_app(tmp_path)).get("/auth/info").json()["providers"]["google"] is True
    file.chmod(0o644)
    with pytest.raises(RuntimeError, match="owner allowlist"):
        create_app(tmp_path)


@pytest.mark.parametrize("field", ["iss", "aud", "exp", "iat", "sub", "nonce"])
def test_missing_required_claims(field):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    claims = {
        "iss": google_auth.ISSUER,
        "aud": "fixture",
        "exp": int(time.time()) + 60,
        "iat": int(time.time()),
        "sub": "fixture-owner",
        "nonce": "fixture-nonce",
    }
    del claims[field]
    token = jwt.encode(claims, private, algorithm="RS256")
    with pytest.raises(jwt.PyJWTError):
        google_auth.validate_token(token, "fixture-nonce", "fixture", private.public_key())


def test_provider_exchange_error_is_redacted_and_flow_consumed(google, monkeypatch):
    _, client, start, _ = google
    query = start()

    class FailingTransport:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, *args, **kwargs):
            raise google_auth.httpx.ConnectError("inert-sensitive-provider-error")

    monkeypatch.setattr(google_auth.httpx, "AsyncClient", FailingTransport)
    response = client.get("/auth/google/callback", params=query)
    assert response.status_code == 401
    assert "inert-sensitive" not in response.text
    assert client.get("/auth/google/callback", params=query).status_code == 401


def test_unicode_state_and_unapproved_file_fail_closed(google, tmp_path, monkeypatch):
    _, client, start, _ = google
    query = start()
    assert client.get("/auth/google/callback", params={**query, "state": "非ascii"}).status_code == 401
    file = tmp_path / "invalid-google-owner.json"
    file.write_text(
        json.dumps(
            {
                "approved": True,
                "issuer": google_auth.ISSUER,
                "client_id": "inert-google-client",
                "redirect_uri": ORIGIN + "/auth/google/callback",
            }
        )
    )
    file.chmod(0o600)
    monkeypatch.setenv("GOOGLE_OWNER_SUB_FILE", str(file))
    with pytest.raises(RuntimeError, match="owner allowlist"):
        create_app(tmp_path / "invalid")


def test_supported_issuer_and_algorithm_allowlist():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    claims = {
        "iss": "accounts.google.com",
        "aud": ["fixture", "second"],
        "azp": "fixture",
        "exp": int(time.time()) + 60,
        "iat": int(time.time()),
        "sub": "fixture-owner",
        "nonce": "fixture-nonce",
    }
    token = jwt.encode(claims, private, algorithm="RS256")
    assert google_auth.validate_token(token, "fixture-nonce", "fixture", private.public_key()) == "fixture-owner"
    token = jwt.encode(claims, "inert-signing-fixture" * 2, algorithm="HS256")
    with pytest.raises(jwt.InvalidAlgorithmError):
        google_auth.validate_token(token, "fixture-nonce", "fixture", private.public_key())
