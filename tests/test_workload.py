import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pytest
from test_app import env as env  # noqa: PLC0414 - re-export the shared pytest fixture
from test_app import put

from job_intel_tracker import workload as w


def job(rid="job", stage="Applied", tracking=None, company=None):
    body = {"title": "Synthetic role", "company": company or rid, "stage": stage}
    if tracking is not None:
        body["tracking"] = tracking
    return {"id": rid, "kind": "job", "version": 1, "body": body}


def applied(on="2026-09-01", **kwargs):
    return {"applied_on": on, "applied_source": "Synthetic owner confirmation", **kwargs}


@pytest.mark.parametrize("stage", ["Applied", "Prospect", "Rejected"])
def test_malformed_empty_legacy_tracking_is_not_silently_replaced(stage):
    record = job(stage=stage, tracking=[])
    state = projection([record])["jobs"]["job"]
    assert state["waiting_days"] is None
    assert "Invalid legacy tracking; no dates inferred" in state["reasons"]
    assert record["body"]["tracking"] == []


def projection(rows, on="2026-09-15T16:00:00+00:00", policy=None):
    return w.project(rows, policy or {}, datetime.fromisoformat(on)).model_dump(mode="json")


@pytest.mark.parametrize("day,status", [(7, "waiting"), (8, "waiting_badge"), (15, "review_due")])
def test_calendar_wait_thresholds(day, status):
    state = projection([job(tracking=applied())], f"2026-09-{day:02}T16:00:00+00:00")["jobs"]["job"]
    assert state["status"] == status
    assert state["waiting_days"] == day - 1


def test_receipts_outbound_and_meaningful_human_contact():
    receipt = {"id": "receipt", "on": "2026-09-14", "kind": "receipt", "source": "Synthetic automated receipt"}
    outbound = {**receipt, "id": "outbound", "kind": "outbound"}
    state = projection([job(tracking=applied(contacts=[receipt, outbound]))])["jobs"]["job"]
    assert state["status"] == "review_due" and state["waiting_days"] == 14
    human = {**receipt, "id": "human", "kind": "human", "source": "Synthetic recruiter reply"}
    state = projection([job(tracking=applied(contacts=[receipt, outbound, human]))])["jobs"]["job"]
    assert state["status"] == "waiting" and state["waiting_days"] == 1
    assert projection([job(tracking={"contacts": [human]})])["jobs"]["job"]["waiting_days"] == 1


def test_schedules_promises_weekends_holidays_and_owner_action_priority():
    t = applied(interview_on="2026-09-16", interview_source="Synthetic invitation")
    assert projection([job(tracking=t)])["jobs"]["job"]["status"] == "interview_scheduled"
    assert projection([job(tracking=t)], "2026-09-17T16:00:00+00:00")["jobs"]["job"]["status"] == "interview_review"
    t = applied(promised_response_on="2026-09-11", promise_source="Synthetic Friday promise")
    assert projection([job(tracking=t)], "2026-09-14T16:00:00+00:00")["jobs"]["job"]["status"] == "promise_waiting"
    state = projection([job(tracking=t)])["jobs"]["job"]
    assert state["status"] == "promise_review" and state["review_on"] == "2026-09-15"
    assert (
        projection([job(tracking=t)], policy={"business_holidays": ["2026-09-14"]})["jobs"]["job"]["status"]
        == "promise_waiting"
    )
    t["next_action"] = {
        "text": "Prepare talking points",
        "owner": "owner",
        "due_on": "2026-09-15",
        "source": "Synthetic task",
    }
    state = projection([job(tracking=t)])["jobs"]["job"]
    assert state["status"] == "action_due" and state["label"] == "Prepare talking points"
    t["next_action"]["owner"] = "agent"
    assert projection([job(tracking=t)])["jobs"]["job"]["status"] == "action_due"


def test_review_choices_do_not_change_stages_or_claim_contact():
    for decision, status in [
        ("park", "parked"),
        ("keep_waiting", "waiting_badge"),
        ("prepare_follow_up", "action_needed"),
    ]:
        record = job(
            tracking=applied(review={"decision": decision, "on": "2026-09-15", "source": "Synthetic owner decision"})
        )
        state = projection([record])["jobs"]["job"]
        assert state["status"] == status and state["waiting_days"] == 14
        assert record["body"]["stage"] == "Applied"
        if decision == "keep_waiting":
            assert state["review_on"] == "2026-09-29"


def test_missing_dates_terminal_backlog_offer_and_invalid_legacy():
    rows = [
        job("unknown"),
        job("closed", "Rejected"),
        job("backlog", "Prospect"),
        job("offer", "Offer"),
        job("legacy", tracking={"applied_on": "not-a-date"}),
        job("closed-invalid", "Closed", {"applied_on": "invalid"}),
    ]
    result = projection(rows)
    assert result["jobs"]["unknown"]["status"] == "dates_unknown"
    assert result["jobs"]["unknown"]["waiting_days"] is None
    assert result["jobs"]["offer"]["status"] == "offer_review"
    assert result["jobs"]["legacy"]["status"] == "dates_unknown"
    assert not result["jobs"]["closed-invalid"]["needs_decision"]
    assert result["counts"]["open_applications"] == 3
    assert {r["job_id"] for r in result["decisions"]} == {"unknown", "offer", "legacy"}


def test_timezone_dst_local_midnight_and_weekly_dedup():
    t = applied("2026-03-01")
    before = projection([job(tracking=t)], "2026-03-08T04:59:00+00:00")
    after = projection([job(tracking=t)], "2026-03-08T05:00:00+00:00")
    assert before["local_date"] == "2026-03-07" and before["jobs"]["job"]["waiting_days"] == 6
    assert after["local_date"] == "2026-03-08" and after["jobs"]["job"]["waiting_days"] == 7
    fall = projection([job(tracking=applied("2026-10-26"))], "2026-11-01T17:00:00+00:00")
    assert fall["jobs"]["job"]["waiting_days"] == 6
    rows = [
        job(
            "both",
            tracking=applied("2026-09-14", shortlisted_on="2026-09-14", shortlisted_source="Synthetic shortlist"),
        ),
        job("Sunday", tracking=applied("2026-09-13")),
        job("backlog", "Prospect", {"shortlisted_on": "2026-09-14", "shortlisted_source": "Synthetic shortlist"}),
    ]
    assert projection(rows)["counts"]["weekly_new"] == 2
    assert projection(rows, "2026-09-21T16:00:00+00:00")["counts"]["weekly_new"] == 0


def test_soft_workload_counts_alternatives_companies_and_pilot_review():
    rows = [job(str(i), tracking=applied()) for i in range(15)]
    for i in range(4):
        rows[i]["body"].update(stage="Interview", company="Same employer" if i < 2 else str(i))
    rows[1]["body"]["primary_id"] = "0"
    rows[5]["body"]["tracking"]["review"] = {"decision": "park", "on": "2026-09-14", "source": "Synthetic decision"}
    result = projection(rows, policy={"pilot_started_on": "2026-09-01"})
    assert result["counts"]["open_applications"] == 15
    assert result["counts"]["interviewing_companies"] == 3
    assert result["counts"]["parked"] == 1
    assert result["counts"]["attention"] + result["counts"]["passive_waiting"] + result["counts"]["parked"] == 15
    assert {r["code"] for r in result["warnings"]} == {"open_applications", "interviewing_companies", "pilot_review"}
    assert projection(rows, policy={"timezone": "invalid"})["warnings"][0]["code"] == "policy_invalid"


def test_authorization_projection_and_no_read_migration(env):
    app, owner, agent = env
    put(owner, "visible")
    put(owner, "private", body={"company": "Other employer", "title": "Other", "stage": "Applied"})
    restricted = agent("SyntheticRestricted", ["read"], ["visible"])
    assert set(restricted.get("/api/workload").json()["jobs"]) == {"visible"}
    assert restricted.get("/api/workload").json()["counts"]["open_applications"] == 1
    with app.state.db() as c:
        before = [tuple(r) for r in c.execute("SELECT * FROM records")]
        audit_before = c.execute("SELECT COUNT(*) FROM audit").fetchone()[0]
    assert owner.get("/api/policy").json()["body"]["open_application_limit"] == 15
    assert owner.get("/api/workload").status_code == 200
    with app.state.db() as c:
        assert before == [tuple(r) for r in c.execute("SELECT * FROM records")]
        assert audit_before == c.execute("SELECT COUNT(*) FROM audit").fetchone()[0]


def test_owner_policy_preserves_new_settings_on_legacy_write(env):
    _, owner, agent = env
    policy = owner.get("/api/policy").json()["body"]
    policy["waiting_days"] = 9
    assert put(owner, "search-policy", "filters", body=policy).status_code == 200
    legacy = {"active_cap": 10, "base_floor": 220000, "lanes": ["Synthetic"]}
    assert put(owner, "search-policy", "filters", version=1, body=legacy).status_code == 200
    assert owner.get("/api/policy").json()["body"]["waiting_days"] == 9
    a = agent("SyntheticWriter", ["read", "jobs:write", "contribute"])
    assert put(a, "search-policy", "filters", version=2, body=policy).status_code == 403
    for key, value in [
        ("timezone", "Invalid/Zone"),
        ("waiting_days", 20),
        ("weekly_new_limit", True),
        ("business_holidays", ["invalid"]),
    ]:
        bad = {**policy, key: value}
        assert put(owner, "search-policy", "filters", version=2, body=bad, key=str(key)).status_code == 422


def test_concurrent_agent_tracking_and_owner_review_protection(env):
    app, owner, agent = env
    a = agent("SyntheticA", ["read", "jobs:write"])
    b = agent("SyntheticB", ["read", "jobs:write"])
    original = {"company": "Synthetic", "title": "Role", "stage": "Applied", "tracking": applied("2020-01-01")}
    assert put(a, body=original).status_code == 200

    def edit(client):
        body = {
            **original,
            "tracking": applied(
                "2020-01-01",
                contacts=[{"id": "receipt", "on": "2020-01-02", "kind": "receipt", "source": "Synthetic receipt"}],
            ),
        }
        return put(client, version=1, body=body, key="same-key-is-scoped-to-actor").status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(edit, [a, b])) == [200, 409]
    current = owner.get("/api/records?kind=job").json()[0]
    body = current["body"]
    body["tracking"]["review"] = {"decision": "park", "on": "2020-01-03", "source": "Synthetic decision"}
    assert put(a, version=2, body=body).status_code == 403
    assert put(owner, version=2, body=body).status_code == 200
    latest = owner.get("/api/records?kind=job").json()[0]
    assert latest["author"] == "SyntheticA"
    kept = {**latest["body"], "title": "Updated title"}
    assert put(b, version=3, body=kept).status_code == 200
    kept["tracking"]["review"] = None
    assert put(b, version=4, body=kept).status_code == 403
    with app.state.db() as c:
        assert c.execute("SELECT actor FROM revisions WHERE id='job1' AND version=3").fetchone()[0] == "owner"
        assert (
            json.loads(c.execute("SELECT body FROM records WHERE id='job1'").fetchone()[0])["tracking"]["review"][
                "decision"
            ]
            == "park"
        )


@pytest.mark.parametrize(
    "tracking",
    [
        {"applied_on": "2020-01-01"},
        {"applied_on": "2999-01-01", "applied_source": "Synthetic"},
        {"contacts": [{"id": "x", "on": "2020-01-01", "kind": "automated-human", "source": "Synthetic"}]},
        {"contacts": [{"id": "x", "on": "2020-01-01", "kind": "human", "source": " "}]},
        {"applied_on": 0, "applied_source": "Synthetic"},
    ],
)
def test_tracking_validation(env, tracking):
    _, owner, _ = env
    assert put(owner, body=job(tracking=tracking)["body"]).status_code == 422


def test_missing_dates_can_be_acknowledged_without_inventing_a_clock():
    row = job(
        tracking={
            "review": {"decision": "keep_waiting", "on": "2026-09-15", "source": "Synthetic owner acknowledgement"}
        }
    )
    current = projection([row])["jobs"]["job"]
    assert current["status"] == "dates_unknown" and current["waiting_days"] is None
    assert current["review_on"] == "2026-09-29" and not current["needs_decision"]
    assert projection([row], "2026-09-29T16:00:00+00:00")["jobs"]["job"]["needs_decision"]


def test_legacy_invalid_policy_is_nonblocking_and_null_holidays_are_rejected(env):
    app, owner, _ = env
    legacy = {"active_cap": 10, "base_floor": 220000, "lanes": ["Synthetic"], "timezone": "invalid"}
    with app.state.db() as c:
        c.execute("INSERT INTO records VALUES('search-policy','filters',NULL,'owner',1,?,0)", (json.dumps(legacy),))
    assert put(owner).status_code == 200
    result = owner.get("/api/workload").json()
    assert result["timezone"] == "America/New_York"
    assert result["warnings"][0]["code"] == "policy_invalid"
    repaired = {**legacy, "timezone": "America/New_York", "business_holidays": [None]}
    assert put(owner, "search-policy", "filters", version=1, body=repaired).status_code == 422


def test_scheduled_interview_counts_without_inventing_a_pipeline_stage():
    row = job(tracking=applied(interview_on="2026-09-16", interview_source="Synthetic scheduled interview"))
    result = projection([row])
    assert result["counts"]["interviewing_companies"] == 1
    assert row["body"]["stage"] == "Applied"


def test_projection_auth_and_mcp_get_workload(env):
    import httpx
    from fastapi.testclient import TestClient

    from job_intel_tracker.mcp import call_tool

    app, owner, agent = env
    assert TestClient(app).get("/api/workload").status_code == 401
    assert agent("SyntheticNoRead", ["contribute"]).get("/api/workload").status_code == 403
    response = owner.get("/api/workload")
    with httpx.Client(
        base_url="https://synthetic.example",
        transport=httpx.MockTransport(lambda req: httpx.Response(200, json=response.json())),
    ) as client:
        assert not call_tool(client, "get_workload", {}).get("isError")
