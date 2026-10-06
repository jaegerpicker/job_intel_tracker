"""Owner requests and leased agent work. Queue text is evidence, never authority."""

import hashlib
import json
import time
import uuid
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import research_outbox

Package = Literal["research", "application_documents", "interview_prep", "full_package"]
Deliverable = Literal["research", "resume", "cover_letter", "interview_prep"]
Status = Literal["queued", "claimed", "completed", "blocked", "cancelled"]
REQUIRED = {
    "research": ["research"],
    "application_documents": ["resume", "cover_letter"],
    "interview_prep": ["interview_prep"],
    "full_package": ["research", "resume", "cover_letter", "interview_prep"],
}
TABLES = """
CREATE TABLE IF NOT EXISTS research_requests(id TEXT PRIMARY KEY,job TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,version INTEGER NOT NULL,body TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS research_one_open ON research_requests(job) WHERE json_extract(body,'$.status') IN ('queued','claimed','blocked');
CREATE TABLE IF NOT EXISTS research_events(request TEXT REFERENCES research_requests(id) ON DELETE CASCADE,version INTEGER,actor TEXT,action TEXT,timestamp REAL,reason TEXT,snapshot TEXT NOT NULL,PRIMARY KEY(request,version));
"""


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Artifact(Strict):
    deliverable: Deliverable
    type: Literal["record", "attachment"]
    id: str = Field(min_length=1, max_length=100)
    version: int = Field(ge=1, strict=True)
    source: str = Field(min_length=1, max_length=2000)
    observed_on: date

    @field_validator("source")
    @classmethod
    def source_nonblank(cls, value):
        if not value.strip():
            raise ValueError("Source required")
        return value

    @field_validator("observed_on", mode="before")
    @classmethod
    def observed_date(cls, value):
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError("Use YYYY-MM-DD")
        date.fromisoformat(value)
        if value > datetime.now(UTC).date().isoformat():
            raise ValueError("Observation cannot be future-dated")
        return value


class ArtifactView(Artifact):
    availability: Literal["available", "missing", "changed", "invalid"]


class NewRequest(Strict):
    package: Package
    note: str = Field(default="", max_length=4000)


class Action(Strict):
    version: int = Field(ge=1, strict=True)
    lease_minutes: int = Field(default=30, ge=5, le=120, strict=True)
    reason: str = Field(default="", max_length=4000)
    note: str = Field(default="", max_length=4000)
    artifacts: list[Artifact] = Field(default_factory=list, max_length=20)


class Event(Strict):
    version: int
    actor: str
    action: str
    timestamp: float
    reason: str
    artifacts: list[Artifact] = Field(default_factory=list)
    completion_note: str = ""
    claimed_by: str | None = None
    lease_until: float | None = None


class WorkRequest(Strict):
    id: str
    job: str
    version: int
    package: Package
    note: str
    status: Status
    created_by: str
    created_at: float
    updated_by: str
    updated_at: float
    claimed_by: str | None = None
    lease_until: float | None = None
    claim_expired: bool = False
    reason: str = ""
    completion_note: str = ""
    completed_at: float | None = None
    artifacts: list[ArtifactView] = Field(default_factory=list)
    required_deliverables: list[Deliverable]
    missing_deliverables: list[Deliverable]
    events: list[Event]


def artifact_state(c, job, artifact, attachment_exists=lambda aid: True):
    if artifact["type"] == "attachment":
        row = c.execute("SELECT * FROM attachments WHERE id=?", (artifact["id"],)).fetchone()
        expected = artifact["deliverable"] in ("resume", "cover_letter")
        if row and not attachment_exists(row["id"]):
            return "missing"
    else:
        row = c.execute("SELECT * FROM records WHERE id=?", (artifact["id"],)).fetchone()
        expected = bool(
            row and row["kind"] == {"research": "research", "interview_prep": "interview"}.get(artifact["deliverable"])
        )
        if row and expected:
            body = json.loads(row["body"])
            expected = isinstance(body.get("text"), str) and bool(body["text"].strip())
    if not row:
        return "missing"
    if row["job"] != job or not expected:
        return "invalid"
    if row["version"] != artifact["version"]:
        return "changed"
    return "available"


def view(c, row, now, attachment_exists=lambda aid: True):
    body = json.loads(row["body"])
    expired = body["status"] == "claimed" and body["lease_until"] <= now
    refs = [{**a, "availability": artifact_state(c, row["job"], a, attachment_exists)} for a in body["artifacts"]]
    present = {a["deliverable"] for a in refs if a["availability"] == "available"}
    required = REQUIRED[body["package"]]
    events = [
        {**{k: r[k] for k in ("version", "actor", "action", "timestamp", "reason")}, **json.loads(r["snapshot"])}
        for r in c.execute(
            "SELECT * FROM research_events WHERE request=? ORDER BY version",
            (row["id"],),
        )
    ]
    return WorkRequest(
        **{
            **body,
            "id": row["id"],
            "job": row["job"],
            "version": row["version"],
            "status": "queued" if expired else body["status"],
            "claimed_by": None if expired else body["claimed_by"],
            "claim_expired": expired,
            "artifacts": refs,
            "required_deliverables": required,
            "missing_deliverables": [d for d in required if d not in present],
            "events": events,
        }
    )


def configure(app, db, principal, audit, attachment_exists):
    with db() as c:
        c.executescript(TABLES)
        c.executescript(research_outbox.TABLES)

    def require_job(c, job):
        if not c.execute("SELECT 1 FROM records WHERE id=? AND kind='job'", (job,)).fetchone():
            raise HTTPException(404, "Job not found")

    def fingerprint(req, body):
        key = req.headers.get("idempotency-key")
        if not key or len(key) > 200:
            raise HTTPException(400, "Idempotency-Key required")
        value = hashlib.sha256(("research:" + req.url.path + json.dumps(body, sort_keys=True)).encode()).hexdigest()
        return key, value

    def cached(c, actor, key, value):
        row = c.execute("SELECT * FROM idem WHERE actor=? AND key=?", (actor, key)).fetchone()
        if row:
            if row["digest"] != value:
                raise HTTPException(409, "Idempotency key reused with different content")
            return json.loads(row["result"])
        return None

    def cache(c, actor, key, value, result):
        c.execute("INSERT INTO idem VALUES(?,?,?,?)", (actor, key, value, result.model_dump_json()))
        return result

    def save(c, rid, job, version, body, actor, action, now, reason=""):
        c.execute("INSERT INTO research_requests VALUES(?,?,?,?)", (rid, job, version, json.dumps(body)))
        event(c, rid, version, actor, action, now, reason, body)
        audit(c, actor, "research-" + action, rid)
        research_outbox.enqueue(c, rid, version, now)
        return view(
            c, c.execute("SELECT * FROM research_requests WHERE id=?", (rid,)).fetchone(), now, attachment_exists
        )

    def event(c, rid, version, actor, action, now, reason, body):
        snapshot = {k: body[k] for k in ("artifacts", "completion_note", "claimed_by", "lease_until")}
        c.execute(
            "INSERT INTO research_events VALUES(?,?,?,?,?,?,?)",
            (rid, version, actor, action, now, reason, json.dumps(snapshot)),
        )

    @app.get("/api/research-requests", response_model=list[WorkRequest])
    def requests(req: Request, job: str | None = None, status: Status | None = None):
        _, jobs = principal(req, "read", job)
        now = time.time()
        with db() as c:
            c.execute("BEGIN")
            if job:
                require_job(c, job)
            rows = c.execute("SELECT * FROM research_requests ORDER BY rowid DESC").fetchall()
            result = [
                view(c, r, now, attachment_exists)
                for r in rows
                if (not job or r["job"] == job) and (not jobs or r["job"] in jobs)
            ]
        return [r for r in result if not status or r.status == status]

    @app.post("/api/jobs/{job}/research-requests", response_model=WorkRequest)
    def create(job: str, p: NewRequest, req: Request):
        actor, _ = principal(req, "jobs:write", job)
        if actor != "owner":
            raise HTTPException(403, "Only owner can request research")
        key, value = fingerprint(req, p.model_dump(mode="json"))
        now = time.time()
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            require_job(c, job)
            prior = cached(c, actor, key, value)
            if prior is not None:
                return prior
            existing = c.execute(
                "SELECT * FROM research_requests WHERE job=? AND json_extract(body,'$.status') IN ('queued','claimed','blocked')",
                (job,),
            ).fetchone()
            if existing:
                if json.loads(existing["body"])["package"] != p.package:
                    raise HTTPException(409, "Open request exists; review or cancel it before changing package")
                return cache(c, actor, key, value, view(c, existing, now, attachment_exists))
            rid = uuid.uuid4().hex
            body = {
                "package": p.package,
                "note": p.note,
                "status": "queued",
                "created_by": actor,
                "created_at": now,
                "updated_by": actor,
                "updated_at": now,
                "claimed_by": None,
                "lease_until": None,
                "reason": "",
                "completion_note": "",
                "completed_at": None,
                "artifacts": [],
            }
            return cache(c, actor, key, value, save(c, rid, job, 1, body, actor, "request", now))

    @app.post("/api/research-requests/{rid}/{action}", response_model=WorkRequest)
    def transition(
        rid: str,
        action: Literal["claim", "renew", "release", "block", "complete", "requeue", "cancel"],
        p: Action,
        req: Request,
    ):
        # Authenticate before resolving a request, then enforce its exact parent job.
        actor, _ = principal(req, "jobs:write" if action in ("requeue", "cancel") else "contribute")
        principal(req, "read")
        key, value = fingerprint(req, p.model_dump(mode="json"))
        now = time.time()
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute("SELECT * FROM research_requests WHERE id=?", (rid,)).fetchone()
            if not row:
                raise HTTPException(404, "Request not found")
            principal(req, "jobs:write" if action in ("requeue", "cancel") else "contribute", row["job"])
            principal(req, "read", row["job"])
            if (action in ("requeue", "cancel")) != (actor == "owner"):
                raise HTTPException(403, "Owner and agent actions are separate")
            prior = cached(c, actor, key, value)
            if prior is not None:
                return prior
            if row["version"] != p.version:
                raise HTTPException(409, "Stale request version; refresh before acting")
            body = json.loads(row["body"])
            expired = body["status"] == "claimed" and body["lease_until"] <= now
            if action == "claim":
                if body["status"] != "queued" and not expired:
                    raise HTTPException(409, "Request is not available to claim")
                body.update(status="claimed", claimed_by=actor, lease_until=now + p.lease_minutes * 60, reason="")
            elif action in ("requeue", "cancel"):
                if action == "requeue" and body["status"] == "queued":
                    raise HTTPException(409, "Request is already queued")
                if body["status"] == "cancelled":
                    raise HTTPException(409, "Request is cancelled; create a new request")
                if (
                    action == "requeue"
                    and c.execute(
                        "SELECT 1 FROM research_requests WHERE job=? AND id!=? AND json_extract(body,'$.status') IN ('queued','claimed','blocked')",
                        (row["job"], rid),
                    ).fetchone()
                ):
                    raise HTTPException(409, "Another open request exists")
                body.update(
                    status="queued" if action == "requeue" else "cancelled",
                    claimed_by=None,
                    lease_until=None,
                    reason=p.reason,
                    completed_at=None,
                )
            else:
                if body["status"] != "claimed" or expired or body["claimed_by"] != actor:
                    raise HTTPException(403, "Your unexpired claim is required")
                if action == "renew":
                    body["lease_until"] = now + p.lease_minutes * 60
                elif action == "release":
                    body.update(status="queued", claimed_by=None, lease_until=None, reason=p.reason)
                else:
                    if action == "block" and not p.reason.strip():
                        raise HTTPException(422, "Blocked work needs a reason")
                    refs = [a.model_dump(mode="json") for a in p.artifacts]
                    seen = set()
                    artifact_ids = set()
                    for ref in refs:
                        if ref["deliverable"] not in REQUIRED[body["package"]] or ref["deliverable"] in seen:
                            raise HTTPException(422, "Use one artifact per requested deliverable")
                        seen.add(ref["deliverable"])
                        identity = (ref["type"], ref["id"])
                        if identity in artifact_ids:
                            raise HTTPException(422, "Use a distinct artifact for each deliverable")
                        artifact_ids.add(identity)
                        if artifact_state(c, row["job"], ref, attachment_exists) != "available":
                            raise HTTPException(422, "Artifact must exist at this version for this job and deliverable")
                        table = "attachments" if ref["type"] == "attachment" else "records"
                        author = c.execute(f"SELECT author FROM {table} WHERE id=?", (ref["id"],)).fetchone()["author"]
                        if author != actor:
                            raise HTTPException(403, "Agents can reference only their own artifacts")
                    if action == "complete" and set(REQUIRED[body["package"]]) != seen:
                        raise HTTPException(
                            422,
                            {
                                "message": "Required deliverables are missing",
                                "missing_deliverables": [d for d in REQUIRED[body["package"]] if d not in seen],
                            },
                        )
                    body.update(
                        status="blocked" if action == "block" else "completed",
                        lease_until=None,
                        reason=p.reason,
                        artifacts=refs,
                        completion_note=p.note,
                        completed_at=now if action == "complete" else None,
                    )
            body.update(updated_by=actor, updated_at=now)
            version = row["version"] + 1
            c.execute("UPDATE research_requests SET version=?,body=? WHERE id=?", (version, json.dumps(body), rid))
            event(c, rid, version, actor, action, now, p.reason, body)
            audit(c, actor, "research-" + action, rid)
            if body["status"] in ("queued", "claimed"):
                research_outbox.enqueue(
                    c, rid, version, now, body["lease_until"] if body["status"] == "claimed" else now
                )
            return cache(
                c,
                actor,
                key,
                value,
                view(
                    c,
                    c.execute("SELECT * FROM research_requests WHERE id=?", (rid,)).fetchone(),
                    now,
                    attachment_exists,
                ),
            )
