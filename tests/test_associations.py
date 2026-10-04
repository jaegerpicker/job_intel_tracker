from fastapi.testclient import TestClient

from job_intel_tracker.app import create_app


def test_public_association_claims_only_native_callback(tmp_path):
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
        }
    }
    assert client.get("/api/records").status_code == 401
    assert client.post("/auth/mobile/start", json={}).status_code in (404, 422)
