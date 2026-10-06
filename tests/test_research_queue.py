import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from test_app import env as env  # noqa: PLC0414 - shared fixture
from test_app import put

from job_intel_tracker import research_outbox


def create(client, job="job1", package="research", key="request", note="Synthetic owner instructions"):
    return client.post(
        f"/api/jobs/{job}/research-requests", headers={"Idempotency-Key": key}, json={"package": package, "note": note}
    )


def act(client, request, action, key=None, **fields):
    return client.post(
        f"/api/research-requests/{request['id']}/{action}",
        headers={"Idempotency-Key": key or action + str(request["version"])},
        json={"version": request["version"], **fields},
    )


def setup(env, package="research"):
    app, owner, agent = env
    assert put(owner).status_code == 200
    request = create(owner, package=package).json()
    return app, owner, agent, request


def ref(deliverable, rid, type="record", version=1):
    return {
        "deliverable": deliverable,
        "type": type,
        "id": rid,
        "version": version,
        "source": "Synthetic evidence",
        "observed_on": datetime.now(UTC).date().isoformat(),
    }


def test_request_is_owner_only_csrf_scoped_and_idempotent(env):
    app, owner, agent, request = setup(env)
    assert create(owner).json() == request
    assert create(owner, key="second-click", note="Do not overwrite owner note").json() == request
    assert create(owner, package="full_package", key="new-package").status_code == 409
    assert create(owner, package="full_package").status_code == 409
    assert create(agent("Eva", ["read", "jobs:write", "contribute"])).status_code == 403
    assert create(TestClient(app)).status_code == 401
    owner.headers.pop("X-CSRF-Token")
    assert create(owner).status_code == 403
    with app.state.db() as c:
        assert c.execute("SELECT COUNT(*) FROM research_requests").fetchone()[0] == 1
        assert c.execute("SELECT COUNT(*) FROM research_outbox").fetchone()[0] == 1


def test_concurrent_requests_and_claims_one_winner(env):
    app, owner, agent = env
    put(owner)
    with ThreadPoolExecutor(2) as pool:
        responses = list(pool.map(lambda key: create(owner, key=key), ["first", "second"]))
    assert all(r.status_code == 200 for r in responses)
    assert responses[0].json()["id"] == responses[1].json()["id"]
    request = responses[0].json()
    eva, hanna = agent("Eva", ["read", "contribute"]), agent("Hanna", ["read", "contribute"])
    with ThreadPoolExecutor(2) as pool:
        claims = list(pool.map(lambda client: act(client, request, "claim"), [eva, hanna]))
    assert sorted(r.status_code for r in claims) == [200, 409]
    winner = next(r.json() for r in claims if r.status_code == 200)
    other = hanna if winner["claimed_by"] == "Eva" else eva
    for action in ("renew", "release", "block", "complete"):
        assert act(other, winner, action, reason="Synthetic").status_code == 403
    assert act(eva, winner, "cancel").status_code == 403
    with app.state.db() as c:
        assert c.execute("SELECT COUNT(*) FROM research_events").fetchone()[0] == 2


def test_expiry_renew_release_owner_control_and_stale_version(env):
    app, owner, agent, request = setup(env)
    eva = agent("Eva", ["read", "contribute"])
    hanna = agent("Hanna", ["read", "contribute"])
    claimed = act(eva, request, "claim", lease_minutes=5).json()
    assert claimed["status"] == "claimed"
    assert act(eva, request, "claim", lease_minutes=5).json() == claimed
    renewed = act(eva, claimed, "renew", lease_minutes=30).json()
    assert renewed["lease_until"] > claimed["lease_until"]
    assert act(eva, claimed, "release").status_code == 409
    with app.state.db() as c:
        body = json.loads(c.execute("SELECT body FROM research_requests").fetchone()[0])
        body["lease_until"] = time.time() - 1
        c.execute("UPDATE research_requests SET body=?", (json.dumps(body),))
    projected = owner.get("/api/research-requests?status=queued").json()[0]
    assert projected["status"] == "queued" and projected["claim_expired"] and projected["claimed_by"] is None
    assert act(eva, renewed, "release").status_code == 403
    claimed = act(hanna, projected, "claim").json()
    assert claimed["claimed_by"] == "Hanna"
    blocked = act(hanna, claimed, "block", reason="Need owner-approved document upload access").json()
    assert blocked["status"] == "blocked" and blocked["lease_until"] is None
    assert act(eva, blocked, "claim").status_code == 409
    assert act(hanna, blocked, "requeue").status_code == 403
    queued = act(owner, blocked, "requeue", reason="Synthetic owner decision").json()
    cancelled = act(owner, queued, "cancel").json()
    assert cancelled["status"] == "cancelled"
    assert act(eva, cancelled, "claim").status_code == 409
    assert create(owner, key="fresh").json()["id"] != request["id"]


def test_job_visibility_and_revoked_credentials(env):
    app, owner, agent, request = setup(env)
    put(owner, rid="job2", body={"title": "Synthetic", "company": "Other Example", "stage": "Applied"})
    create(owner, job="job2", key="other")
    limited = agent("Eva", ["read", "contribute"], ["job2"])
    assert len(limited.get("/api/research-requests").json()) == 1
    assert limited.get("/api/research-requests?job=job1").status_code == 403
    assert act(limited, request, "claim").status_code == 403
    read = agent("Read", ["read"])
    assert act(read, request, "claim").status_code == 403
    write_only = agent("WriteOnly", ["contribute"])
    assert act(write_only, request, "claim").status_code == 403
    assert write_only.get("/api/research-requests").status_code == 403
    anonymous = TestClient(app)
    assert anonymous.get("/api/research-requests").status_code == 401
    assert act(anonymous, request, "claim").status_code == 401
    with app.state.db() as c:
        c.execute("UPDATE tokens SET revoked=1 WHERE name='Eva'")
    assert limited.get("/api/research-requests").status_code == 401


def test_completion_requires_owned_actual_artifacts_and_tracks_changes(env):
    _app, owner, agent, request = setup(env)
    eva = agent("Eva", ["read", "contribute"])
    hanna = agent("Hanna", ["read", "contribute"])
    claimed = act(eva, request, "claim").json()
    assert act(eva, claimed, "complete", artifacts=[]).status_code == 422
    assert act(eva, claimed, "complete", artifacts=[ref("research", "missing")]).status_code == 422
    evidence = {"text": "Synthetic sourced deep dive", "source": "https://example.com", "observed_at": "2026-10-06"}
    put(hanna, rid="hanna-research", kind="research", job="job1", body=evidence)
    assert act(eva, claimed, "complete", artifacts=[ref("research", "hanna-research")]).status_code == 403
    put(eva, rid="eva-research", kind="research", job="job1", body=evidence)
    completed = act(
        eva, claimed, "complete", artifacts=[ref("research", "eva-research")], note="Synthetic complete"
    ).json()
    assert completed["status"] == "completed" and completed["missing_deliverables"] == []
    assert completed["events"][-1]["actor"] == "Eva"
    assert completed["events"][-1]["artifacts"][0]["id"] == "eva-research"
    assert completed["events"][-1]["completion_note"] == "Synthetic complete"
    assert (
        act(eva, claimed, "complete", artifacts=[ref("research", "eva-research")], note="Synthetic complete").json()
        == completed
    )
    put(
        eva,
        rid="eva-research",
        kind="research",
        job="job1",
        version=1,
        body={**evidence, "text": "Updated synthetic evidence"},
    )
    row = owner.get("/api/research-requests").json()[0]
    assert row["status"] == "completed" and row["missing_deliverables"] == ["research"]
    assert row["artifacts"][0]["availability"] == "changed"
    queued = act(owner, row, "requeue").json()
    assert queued["events"][-2]["artifacts"][0]["version"] == 1
    assert queued["events"][-2]["actor"] == "Eva"
    assert owner.delete("/api/records/eva-research?version=2").status_code == 200
    assert owner.get("/api/research-requests").json()[0]["artifacts"][0]["availability"] == "missing"


def test_documents_upload_only_scope_and_distinct_artifacts(env):
    app, owner, agent, request = setup(env, package="application_documents")
    eva = agent("Eva", ["read", "contribute", "attachments:write"])
    claimed = act(eva, request, "claim").json()

    def upload(name, key):
        return eva.post(
            "/api/jobs/job1/attachments",
            headers={"Idempotency-Key": key},
            files={"file": (name, b"Synthetic document only", "text/plain")},
        ).json()["id"]

    resume = upload("synthetic-resume.txt", "upload-resume")
    cover = upload("synthetic-cover.txt", "upload-cover")
    assert eva.get("/api/jobs/job1/attachments").status_code == 403
    assert eva.get("/api/attachments/" + resume).status_code == 403
    assert (
        act(
            eva,
            claimed,
            "complete",
            artifacts=[ref("resume", resume, "attachment"), ref("cover_letter", resume, "attachment")],
        ).status_code
        == 422
    )
    completed = act(
        eva,
        claimed,
        "complete",
        artifacts=[ref("resume", resume, "attachment"), ref("cover_letter", cover, "attachment")],
    ).json()
    assert completed["missing_deliverables"] == []
    assert all("filename" not in a for a in completed["artifacts"])
    with app.state.db() as c:
        row = c.execute("SELECT body FROM research_requests").fetchone()
        assert row
    assert owner.delete("/api/attachments/" + cover).status_code == 200
    assert owner.get("/api/research-requests").json()[0]["missing_deliverables"] == ["cover_letter"]


def test_full_package_partial_block_and_identity_edit_preserves_queue(env):
    app, owner, agent, request = setup(env, package="full_package")
    eva = agent("Eva", ["read", "contribute"])
    claimed = act(eva, request, "claim").json()
    assert act(eva, claimed, "block", reason="   ").status_code == 422
    assert act(eva, claimed, "complete", artifacts=[ref("resume", "job1")]).status_code == 422
    blocked = act(eva, claimed, "block", reason="Missing approved attachment upload grant").json()
    assert set(blocked["missing_deliverables"]) == {"research", "resume", "cover_letter", "interview_prep"}
    job = owner.get("/api/records?kind=job").json()[0]
    assert (
        put(owner, version=job["version"], body={**job["body"], "title": "Updated synthetic title"}).status_code == 200
    )
    assert owner.get("/api/research-requests").json()[0]["id"] == request["id"]
    assert len(owner.get("/api/research-requests").json()[0]["events"]) == 3
    assert owner.delete("/api/records/job1?version=2").status_code == 200
    assert owner.get("/api/research-requests").json() == []
    with app.state.db() as c:
        assert c.execute("SELECT COUNT(*) FROM research_events").fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM research_outbox").fetchone()[0] == 0


@pytest.mark.parametrize(
    "fields", [{"lease_minutes": True}, {"version": True}, {"lease_minutes": 121}, {"unknown": "authority"}]
)
def test_strict_action_validation(env, fields):
    _, _, agent, request = setup(env)
    eva = agent("Eva", ["read", "contribute"])
    assert act(eva, request, "claim", **fields).status_code == 422


def test_outbox_retry_dedup_scope_and_no_authority(env):
    app, owner, agent, request = setup(env)
    now = time.time() + 1
    received = []

    def lost_ack(event):
        received.append(event)
        raise RuntimeError("Synthetic secret must not be persisted")

    assert not research_outbox.dispatch_one(app.state.db, "Eva", lambda c, j: False, lost_ack, now)
    assert received == []
    assert not research_outbox.dispatch_one(app.state.db, "Eva", lambda c, j: True, lost_ack, now)
    assert not research_outbox.dispatch_one(app.state.db, "Eva", lambda c, j: True, lost_ack, now + 29)
    assert research_outbox.dispatch_one(
        app.state.db, "Eva", lambda c, j: True, lambda event: received.append(event) or True, now + 31
    )
    assert received[0] == received[1]
    assert set(received[0]) == {"event_id", "type", "request_id", "request_version", "occurred_at"}
    assert not research_outbox.dispatch_one(app.state.db, "Eva", lambda c, j: True, lost_ack, now + 100)
    assert owner.get("/api/research-requests").json()[0]["status"] == "queued"
    with app.state.db() as c:
        assert c.execute("SELECT last_error FROM research_deliveries").fetchone()[0] == ""
    eva = agent("Eva", ["read", "contribute"])
    claimed = act(eva, request, "claim", lease_minutes=5).json()
    assert not research_outbox.dispatch_one(app.state.db, "Hanna", lambda c, j: True, lambda event: True, now + 100)
    expiry = claimed["lease_until"] + 1
    assert research_outbox.dispatch_one(app.state.db, "Hanna", lambda c, j: True, lambda event: True, expiry)
    assert owner.get("/api/research-requests").json()[0]["claimed_by"] == "Eva"


def test_outbox_concurrency_and_abandoned_delivery_lease(env):
    app, _owner, _agent, _request = setup(env)
    now = time.time() + 1
    with app.state.db() as c:
        event = c.execute("SELECT * FROM research_outbox").fetchone()
        c.execute(
            "INSERT INTO research_deliveries VALUES(?,?,?,?,?,?,?)",
            (event["event_id"], "Eva", "leased", 0, now, now + 60, ""),
        )
    assert not research_outbox.dispatch_one(app.state.db, "Eva", lambda c, j: True, lambda event: True, now + 59)
    with ThreadPoolExecutor(2) as pool:
        results = list(
            pool.map(
                lambda _: research_outbox.dispatch_one(
                    app.state.db, "Eva", lambda c, j: True, lambda event: True, now + 61
                ),
                range(2),
            )
        )
    assert results.count(True) == 1


def test_mcp_reads_and_claims_existing_agent_scope(env):
    import httpx

    from job_intel_tracker.mcp import call_tool

    _app, _, agent, request = setup(env)
    eva = agent("Eva", ["read", "contribute"])

    class Transport(httpx.BaseTransport):
        def handle_request(self, req):
            response = eva.request(req.method, str(req.url), content=req.content, headers=dict(req.headers))
            return httpx.Response(response.status_code, json=response.json())

    with httpx.Client(base_url="http://testserver", transport=Transport()) as client:
        assert not call_tool(client, "get_research_requests", {}).get("isError")
        assert not call_tool(
            client,
            "research_work_action",
            {"id": request["id"], "action": "claim", "version": 1, "idempotency_key": "mcp-claim"},
        ).get("isError")
        with pytest.raises(ValueError):
            call_tool(
                client,
                "research_work_action",
                {"id": request["id"], "action": "cancel", "version": 1, "idempotency_key": "bad"},
            )


def test_native_owner_queue_without_admin_or_agent_authority(env):
    import hashlib

    app, _owner, _agent, _request = setup(env)
    app.state.mobile_enabled = True
    token = "inert-native-queue-owner"
    with app.state.db() as c:
        c.execute(
            "INSERT INTO mobile_sessions VALUES(?,?,0)", (hashlib.sha256(token.encode()).hexdigest(), time.time() + 60)
        )
    native = TestClient(app)
    native.headers["Authorization"] = "Bearer " + token
    request = native.get("/api/research-requests").json()[0]
    assert create(native, key="native-repeat").json()["id"] == request["id"]
    assert act(native, request, "claim").status_code == 403
    assert act(native, request, "cancel").json()["status"] == "cancelled"
    assert native.get("/api/export").status_code == 403
    assert native.get("/api/agents").status_code == 403


def test_full_package_completion_and_wrong_job_artifact(env):
    _app, owner, agent, request = setup(env, package="full_package")
    eva = agent("Eva", ["read", "contribute", "attachments:write"])
    claimed = act(eva, request, "claim").json()
    put(owner, rid="job2", body={"company": "Another Example", "title": "Synthetic role", "stage": "Applied"})
    evidence = {"text": "Synthetic deep dive", "source": "https://example.com", "observed_at": "2026-10-06"}
    put(eva, rid="other-research", kind="research", job="job2", body=evidence)
    assert (
        act(eva, claimed, "block", reason="Synthetic", artifacts=[ref("research", "other-research")]).status_code == 422
    )
    put(eva, rid="research", kind="research", job="job1", body=evidence)
    put(eva, rid="prep", kind="interview", job="job1", body={"text": "Synthetic questions and talking points"})
    refs = [ref("research", "research"), ref("interview_prep", "prep")]
    for deliverable in ("resume", "cover_letter"):
        uploaded = eva.post(
            "/api/jobs/job1/attachments",
            headers={"Idempotency-Key": deliverable},
            files={"file": (deliverable + ".txt", b"Synthetic only", "text/plain")},
        ).json()
        refs.append(ref(deliverable, uploaded["id"], "attachment"))
    completed = act(eva, claimed, "complete", artifacts=refs).json()
    assert completed["status"] == "completed" and completed["missing_deliverables"] == []
    assert len(completed["events"][-1]["artifacts"]) == 4
