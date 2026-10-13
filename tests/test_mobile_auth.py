"""Inert synthetic owner sessions; no real credentials or external provider requests."""

import base64
import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from job_intel_tracker.app import create_app

ORIGIN = "https://tracker.example"
CALLBACK = ORIGIN + "/auth/mobile/callback"
VERIFIER = "v" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).decode().rstrip("=")


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv("MOBILE_AUTH_ENABLED", "1")
    monkeypatch.setenv("APPLE_OWNER_SUB", "synthetic-owner")
    monkeypatch.setenv("PUBLIC_BASE_URL", ORIGIN)
    monkeypatch.setenv("MOBILE_REDIRECT_URIS", json.dumps([CALLBACK]))
    app = create_app(tmp_path)
    browser = TestClient(app, base_url=ORIGIN)
    with app.state.db() as c:
        c.execute(
            "INSERT INTO sessions VALUES(?,?,?)",
            (hashlib.sha256(b"synthetic-browser").hexdigest(), "synthetic-csrf", time.time() + 300),
        )
    browser.cookies.set("session", "synthetic-browser")
    return app, browser, TestClient(app, base_url=ORIGIN)


def start(client, **changes):
    body = {
        "redirect_uri": CALLBACK,
        "code_challenge": CHALLENGE,
        "code_challenge_method": "S256",
        "client_state": "s" * 43,
        "provider": "apple",
    }
    return client.post("/auth/mobile/start", json={**body, **changes})


def approved(browser, client):
    result = start(client).json()
    ticket = parse_qs(urlparse(result["authorization_url"]).query)["ticket"][0]
    page = browser.get(result["authorization_url"])
    assert page.status_code == 200 and "Approve mobile sign-in" in page.text
    response = browser.post(
        "/auth/mobile/approve",
        headers={"Origin": ORIGIN},
        data={"ticket": ticket, "csrf": "synthetic-csrf"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    values = parse_qs(urlparse(response.headers["location"]).query)
    assert values["state"] == ["s" * 43]
    return {"code": values["code"][0], "code_verifier": VERIFIER, "redirect_uri": CALLBACK}, ticket


def authenticated(browser, client):
    payload, _ = approved(browser, client)
    response = client.post("/auth/mobile/exchange", json=payload)
    assert response.status_code == 200
    token = response.json()["access_token"]
    assert token.startswith("mobile_")
    client.headers["Authorization"] = "Bearer " + token
    return token


@pytest.mark.parametrize(
    "changes",
    [
        {"redirect_uri": CALLBACK + "/evil"},
        {"redirect_uri": "javascript:alert(1)"},
        {"provider": "unknown"},
        {"code_challenge_method": "plain"},
        {"code_challenge": "x"},
        {"client_state": "<script>"},
    ],
)
def test_start_validation(setup, changes):
    _, _, client = setup
    assert start(client, **changes).status_code == 400
    assert start(client).status_code == 200


def test_disabled_and_config_fail_closed(tmp_path, monkeypatch):
    monkeypatch.delenv("MOBILE_AUTH_ENABLED", raising=False)
    assert start(TestClient(create_app(tmp_path))).status_code == 404
    monkeypatch.setenv("MOBILE_AUTH_ENABLED", "1")
    monkeypatch.setenv("APPLE_OWNER_SUB", "synthetic-owner")
    monkeypatch.setenv("PUBLIC_BASE_URL", ORIGIN)
    for callback in [
        "http://mobile.example/auth",
        "https://evil@mobile.example/auth",
        "https://mobile.example/auth?code=bad",
        "jobintel://auth",
        "https://mobile.example",
        "https://mobile.example/auth/return",
        "https://mobile.example/auth/mobile/callback",
        "https://MOBILE.example/auth/mobile/callback",
        "https://mobile.example:0443/auth/mobile/callback",
    ]:
        monkeypatch.setenv("MOBILE_REDIRECT_URIS", json.dumps([callback]))
        with pytest.raises(RuntimeError):
            create_app(tmp_path)


def test_approval_requires_cookie_origin_and_csrf(setup):
    app, browser, client = setup
    ticket = parse_qs(urlparse(start(client).json()["authorization_url"]).query)["ticket"][0]
    page = client.get("/auth/mobile/authorize", params={"ticket": ticket}, follow_redirects=False)
    assert page.status_code == 303 and page.headers["location"].startswith("/auth/apple?mobile_ticket=")
    for headers, csrf in [
        ({}, "synthetic-csrf"),
        ({"Origin": "https://evil.example"}, "synthetic-csrf"),
        ({"Origin": ORIGIN}, "wrong"),
    ]:
        assert (
            browser.post("/auth/mobile/approve", headers=headers, data={"ticket": ticket, "csrf": csrf}).status_code
            == 403
        )
    assert (
        client.post(
            "/auth/mobile/approve", headers={"Origin": ORIGIN}, data={"ticket": ticket, "csrf": "synthetic-csrf"}
        ).status_code
        == 401
    )
    with app.state.db() as c:
        assert c.execute("SELECT code_hash FROM mobile_flows").fetchone()[0] is None
    assert start(client, provider="apple").status_code == 200
    assert client.post("/auth/mobile/start", headers={"Origin": "https://evil.example"}, json={}).status_code == 422


def test_pkce_binding_one_use_and_replay(setup):
    app, browser, client = setup
    payload, ticket = approved(browser, client)
    for changed in [{"code_verifier": "x" * 64}, {"redirect_uri": CALLBACK + "evil"}, {"code": "x" * 43}]:
        result = client.post("/auth/mobile/exchange", json={**payload, **changed})
        assert result.status_code == 401
        assert payload["code"] not in result.text and VERIFIER not in result.text
    result = client.post("/auth/mobile/exchange", json=payload)
    token = result.json()["access_token"]
    assert result.status_code == 200 and 899 <= result.json()["expires_at"] - time.time() <= 900
    assert client.post("/auth/mobile/exchange", json=payload).status_code == 401
    assert (
        browser.post(
            "/auth/mobile/approve", headers={"Origin": ORIGIN}, data={"ticket": ticket, "csrf": "synthetic-csrf"}
        ).status_code
        == 401
    )
    with app.state.db() as c:
        serialized = "\n".join(
            str(tuple(r))
            for table in ("mobile_flows", "mobile_sessions", "audit")
            for r in c.execute("SELECT * FROM " + table)
        )
    assert token not in serialized and payload["code"] not in serialized and VERIFIER not in serialized


def test_concurrent_exchange_exactly_one(setup):
    app, browser, client = setup
    payload, _ = approved(browser, client)

    def redeem(_):
        return TestClient(app, base_url=ORIGIN).post("/auth/mobile/exchange", json=payload).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(redeem, range(2))) == [200, 401]


@pytest.mark.parametrize("field", ["expires", "code_expires"])
def test_expired_handoff(setup, field):
    app, browser, client = setup
    payload, _ = approved(browser, client)
    with app.state.db() as c:
        c.execute("UPDATE mobile_flows SET " + field + "=0")
    assert client.post("/auth/mobile/exchange", json=payload).status_code == 401


def test_live_writes_scope_idempotency_conflict_and_logout(setup):
    _app, browser, client = setup
    token = authenticated(browser, client)
    assert client.get("/api/me").json()["actor"] == "owner"
    body = {
        "kind": "job",
        "version": 0,
        "body": {"title": "Synthetic role", "company": "Fixture company", "stage": "Prospect"},
    }
    result = client.put("/api/records/fixture", json=body, headers={"Idempotency-Key": "write1"})
    assert result.status_code == 200
    assert client.put("/api/records/fixture", json=body, headers={"Idempotency-Key": "write1"}).json() == result.json()
    assert client.put("/api/records/fixture", json=body, headers={"Idempotency-Key": "write2"}).status_code == 409
    for endpoint in ("/api/agents", "/api/audit", "/api/export"):
        assert client.get(endpoint).status_code == 403
    assert client.post("/api/agents", json={"name": "No", "scopes": ["read"]}).status_code == 403
    assert client.delete("/api/records/fixture?version=1").status_code == 403
    assert client.post("/api/jobs/fixture/attachments", files={"file": ("fixture.txt", b"fixture")}).status_code == 403
    assert client.get("/api/jobs/fixture/attachments").json() == []
    # Cookie writes continue to require CSRF even after native auth is enabled.
    assert browser.put("/api/records/second", json=body, headers={"Idempotency-Key": "cookie"}).status_code == 403
    assert client.post("/auth/mobile/logout", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/auth/mobile/logout").status_code == 200
    assert client.post("/auth/mobile/logout").status_code == 200
    assert client.get("/api/records").status_code == 401
    assert client.put("/api/records/second", json=body, headers={"Idempotency-Key": "afterlogout"}).status_code == 401
    assert token not in browser.get("/api/audit").text
    # Native logout leaves the browser's separate session intact.
    assert browser.get("/api/me").status_code == 200


def test_native_session_expiry(setup):
    app, browser, client = setup
    authenticated(browser, client)
    with app.state.db() as c:
        c.execute("UPDATE mobile_sessions SET expires=0")
    assert client.get("/api/me").status_code == 401


def test_validation_does_not_echo_secrets(setup):
    _, _, client = setup
    secret = "synthetic-sensitive-verifier"
    result = client.post(
        "/auth/mobile/exchange", json={"code": secret, "code_verifier": {"nested": secret}, "redirect_uri": CALLBACK}
    )
    assert result.status_code == 422 and secret not in result.text
    assert result.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("subject", ["synthetic-owner", "wrong-owner"])
def test_signed_mock_apple_bridge(setup, tmp_path, monkeypatch, subject):
    from types import SimpleNamespace

    import jwt
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec, rsa

    from job_intel_tracker import app as module

    _, _, client = setup
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    signer = ec.generate_private_key(ec.SECP256R1())
    path = tmp_path / "synthetic-key.pem"
    path.write_bytes(
        signer.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
    )
    for key, value in {
        "APPLE_CLIENT_ID": "synthetic-client",
        "APPLE_REDIRECT_URI": ORIGIN + "/auth/callback",
        "APPLE_TEAM_ID": "synthetic-team",
        "APPLE_KEY_ID": "synthetic-key",
        "APPLE_PRIVATE_KEY_FILE": str(path),
    }.items():
        monkeypatch.setenv(key, value)
    ticket = parse_qs(urlparse(start(client).json()["authorization_url"]).query)["ticket"][0]
    response = client.get("/auth/apple", params={"mobile_ticket": ticket}, follow_redirects=False)
    values = parse_qs(urlparse(response.headers["location"]).query)
    signed = jwt.encode(
        {
            "iss": "https://appleid.apple.com",
            "aud": "synthetic-client",
            "sub": subject,
            "nonce": values["nonce"][0],
            "iat": int(time.time()),
            "exp": int(time.time()) + 60,
        },
        private,
        algorithm="RS256",
    )

    class FakeHTTP:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, data):
            assert url == "https://appleid.apple.com/auth/token"
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"id_token": signed})

    monkeypatch.setattr(module.httpx, "AsyncClient", FakeHTTP)
    monkeypatch.setattr(
        module.jwt,
        "PyJWKClient",
        lambda url: SimpleNamespace(get_signing_key_from_jwt=lambda token: SimpleNamespace(key=private.public_key())),
    )
    response = client.post(
        "/auth/callback", data={"state": values["state"][0], "code": "synthetic-provider-code"}, follow_redirects=False
    )
    if subject != "synthetic-owner":
        assert response.status_code == 401 and client.get("/api/me").status_code == 401
    else:
        assert response.status_code == 303 and response.headers["location"] == "/auth/mobile/authorize?ticket=" + ticket
        assert client.get(response.headers["location"]).status_code == 200
        # Provider success grants a browser session only; native exchange needs explicit approval.
        assert (
            client.post(
                "/auth/mobile/exchange", json={"code": "x" * 43, "code_verifier": VERIFIER, "redirect_uri": CALLBACK}
            ).status_code
            == 401
        )
    assert (
        client.post("/auth/callback", data={"state": values["state"][0], "code": "synthetic-provider-code"}).status_code
        == 401
    )


def test_overlapping_interrupted_login_and_expired_browser(setup):
    app, browser, client = setup
    first = start(client).json()
    second = start(client).json()
    assert first["authorization_url"] != second["authorization_url"]
    first_ticket = parse_qs(urlparse(first["authorization_url"]).query)["ticket"][0]
    with app.state.db() as c:
        c.execute(
            "UPDATE mobile_flows SET expires=0 WHERE hash=?", (hashlib.sha256(first_ticket.encode()).hexdigest(),)
        )
    assert browser.get(first["authorization_url"]).status_code == 401
    assert browser.get(second["authorization_url"]).status_code == 200
    # Browser logout/revocation between display and approval prevents minting.
    second_ticket = parse_qs(urlparse(second["authorization_url"]).query)["ticket"][0]
    with app.state.db() as c:
        c.execute("DELETE FROM sessions")
    assert (
        browser.post(
            "/auth/mobile/approve", headers={"Origin": ORIGIN}, data={"ticket": second_ticket, "csrf": "synthetic-csrf"}
        ).status_code
        == 401
    )


def test_bearer_never_returns_browser_csrf_or_authorizes_browser_bridge(setup):
    _, browser, client = setup
    token = authenticated(browser, client)
    browser.headers["Authorization"] = "Bearer " + token
    assert browser.get("/api/me").json()["csrf"] is None
    assert browser.post("/auth/logout", headers={"X-CSRF-Token": "synthetic-csrf"}).status_code == 403
    url = start(client).json()["authorization_url"]
    assert browser.get(url).status_code == 403


def test_attachment_binary_denied_to_mobile_owner(setup, tmp_path):
    app, browser, client = setup
    authenticated(browser, client)
    body = {"kind": "job", "version": 0, "body": {"title": "Synthetic role", "company": "Fixture", "stage": "Prospect"}}
    assert client.put("/api/records/fixture", json=body, headers={"Idempotency-Key": "job"}).status_code == 200
    with app.state.db() as c:
        c.execute(
            "INSERT INTO attachments VALUES(?,?,?,?,?,?,?)",
            ("a" * 32, "fixture", "owner", "synthetic.txt", "text/plain", 1, time.time()),
        )
    (tmp_path / "uploads" / ("a" * 32)).write_text("synthetic")
    assert client.get("/api/jobs/fixture/attachments").json()[0]["filename"] == "synthetic.txt"
    assert client.get("/api/attachments/" + "a" * 32).status_code == 403


def test_native_policy_and_cap_override_denied(setup):
    _, browser, client = setup
    authenticated(browser, client)
    policy = {"kind": "filters", "version": 0, "body": {"active_cap": 1, "base_floor": 1, "lanes": ["Synthetic"]}}
    assert (
        client.put("/api/records/search-policy", json=policy, headers={"Idempotency-Key": "policy"}).status_code == 403
    )
    job = {"kind": "job", "version": 0, "body": {"title": "Synthetic role", "company": "Fixture", "stage": "Applied"}}
    assert (
        client.put(
            "/api/records/fixture", json=job, headers={"Idempotency-Key": "override", "X-Owner-Cap-Override": "true"}
        ).status_code
        == 403
    )
    assert client.put("/api/records/fixture", json=job, headers={"Idempotency-Key": "ordinary"}).status_code == 200
    note = {"kind": "note", "job": "fixture", "version": 0, "body": {"text": "Synthetic note"}}
    prep = {"kind": "interview", "job": "fixture", "version": 0, "body": {"text": "Synthetic preparation"}}
    assert client.put("/api/records/note", json=note, headers={"Idempotency-Key": "note"}).status_code == 200
    assert client.put("/api/records/prep", json=prep, headers={"Idempotency-Key": "prep"}).status_code == 200
    assert client.get("/api/policy").json()["body"]["active_cap"] == 10


def test_browser_callback_fallback_never_reflects_or_consumes_secrets(setup):
    app, browser, client = setup
    payload, _ = approved(browser, client)
    secret_state = "synthetic-private-state"
    response = client.get("/auth/mobile/callback", params={"code": payload["code"], "state": secret_state})
    assert response.status_code == 200
    assert "Return to the mobile app" in response.text
    assert payload["code"] not in response.text and secret_state not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "set-cookie" not in response.headers
    with app.state.db() as c:
        assert c.execute("SELECT COUNT(*) FROM mobile_sessions").fetchone()[0] == 0
    # The inert page neither issues a credential nor redeems/invalidates a pending code.
    assert client.post("/auth/mobile/exchange", json=payload).status_code == 200
