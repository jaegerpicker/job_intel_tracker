import pytest
from fastapi.testclient import TestClient

from job_intel_tracker.app import create_app


def test_public_association_claims_only_native_callback(tmp_path, monkeypatch):
    monkeypatch.delenv("MOBILE_APP_ID", raising=False)
    client = TestClient(create_app(tmp_path, demo=True))
    response = client.get("/.well-known/apple-app-site-association", follow_redirects=False)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.headers["cache-control"] == "public, max-age=300"
    assert "set-cookie" not in response.headers
    assert response.json() == {
        "applinks": {
            "apps": [],
            "details": [
                {
                    "appID": "VHWFV2V25Z.com.sandkcampbell.jobinteltracker",
                    "paths": ["/auth/mobile/callback"],
                }
            ],
        },
        "webcredentials": {"apps": ["VHWFV2V25Z.com.sandkcampbell.jobinteltracker"]},
    }
    assert client.get("/api/records").status_code == 401
    assert client.post("/auth/mobile/start", json={}).status_code in (404, 422)


def test_fork_association_is_explicit_and_does_not_grant_access(tmp_path, monkeypatch):
    identity = "EXAMPLE123.com.example.fieldnotes"
    monkeypatch.setenv("MOBILE_APP_ID", identity)
    client = TestClient(create_app(tmp_path, demo=True))
    association = client.get("/.well-known/apple-app-site-association").json()
    assert association["applinks"]["details"] == [{"appID": identity, "paths": ["/auth/mobile/callback"]}]
    assert association["webcredentials"]["apps"] == [identity]
    assert client.get("/api/records").status_code == 401
    assert client.post("/auth/mobile/start", json={}).status_code in (404, 422)


@pytest.mark.parametrize(
    "identity",
    [
        "",
        "EXAMPLE123.*",
        "EXAMPLE123.com.example.*",
        "example123.com.example.app",
        "EXAMPLE123.com.example.app\n",
        "https://example.com",
        "EXAMPLE123.com.example.app/other",
    ],
)
def test_invalid_association_refuses_start_without_creating_storage(tmp_path, monkeypatch, identity):
    monkeypatch.setenv("MOBILE_APP_ID", identity)
    storage = tmp_path / "must-not-be-created"
    with pytest.raises(RuntimeError, match="MOBILE_APP_ID"):
        create_app(storage, demo=True)
    assert not storage.exists()
