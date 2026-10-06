"""Durable work-available outbox. No network transport or destinations are configured.

A future approved adapter supplies recipient authorization and a bounded sender.
Delivery never grants board authority and never completes research work.
"""

import json
import time
import uuid

TABLES = """
CREATE TABLE IF NOT EXISTS research_outbox(event_id TEXT PRIMARY KEY,request TEXT NOT NULL REFERENCES research_requests(id) ON DELETE CASCADE,version INTEGER,occurred_at REAL,available_at REAL,UNIQUE(request,version));
CREATE TABLE IF NOT EXISTS research_deliveries(event_id TEXT REFERENCES research_outbox(event_id) ON DELETE CASCADE,recipient TEXT,status TEXT,attempts INTEGER,next_attempt REAL,lease_until REAL,last_error TEXT,PRIMARY KEY(event_id,recipient));
"""


def enqueue(c, rid, version, now, available_at=None):
    c.execute(
        "INSERT INTO research_outbox VALUES(?,?,?,?,?)",
        (uuid.uuid4().hex, rid, version, now, now if available_at is None else available_at),
    )


def dispatch_one(db, recipient, authorized, send, now=None):
    """Send at most one minimal event to an already approved recipient.

    `authorized(connection, job_id)` MUST match that recipient's existing job scope.
    `send(event)` MUST be bounded to less than the 60-second delivery lease, validate
    the configured receiver, and return True only on an accepted acknowledgement.
    This function does not configure credentials, sign events, or make HTTP calls.
    Retries reuse event_id; receivers deduplicate but still fetch/claim via REST.
    """
    now = time.time() if now is None else now
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        events = c.execute(
            "SELECT * FROM research_outbox WHERE available_at<=? ORDER BY occurred_at", (now,)
        ).fetchall()
        selected = None
        for event in events:
            delivery = c.execute(
                "SELECT * FROM research_deliveries WHERE event_id=? AND recipient=?", (event["event_id"], recipient)
            ).fetchone()
            if delivery and (
                delivery["status"] in ("delivered", "superseded")
                or delivery["next_attempt"] > now
                or (delivery["status"] == "leased" and delivery["lease_until"] > now)
            ):
                continue
            request = c.execute("SELECT * FROM research_requests WHERE id=?", (event["request"],)).fetchone()
            if not request:
                continue
            body = json.loads(request["body"])
            available = body["status"] == "queued" or (body["status"] == "claimed" and body["lease_until"] <= now)
            # Unauthorized destinations do not learn IDs and may later become authorized.
            if not authorized(c, request["job"]):
                continue
            attempts = delivery["attempts"] if delivery else 0
            state = "leased" if available and request["version"] == event["version"] else "superseded"
            c.execute(
                "INSERT INTO research_deliveries VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_id,recipient) DO UPDATE SET status=excluded.status,lease_until=excluded.lease_until",
                (event["event_id"], recipient, state, attempts, now, now + 60, ""),
            )
            if state == "leased":
                selected = dict(event)
                break
    if selected is None:
        return False
    payload = {
        "event_id": selected["event_id"],
        "type": "work_available",
        "request_id": selected["request"],
        "request_version": selected["version"],
        "occurred_at": selected["occurred_at"],
    }
    try:
        accepted = send(payload) is True
    except Exception:  # noqa: BLE001 - transport boundary must retry without persisting potentially secret exception text
        # Never persist exception text, receiver responses, tokens or destination URLs.
        accepted = False
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        delivery = c.execute(
            "SELECT * FROM research_deliveries WHERE event_id=? AND recipient=?", (selected["event_id"], recipient)
        ).fetchone()
        if not delivery or delivery["status"] != "leased" or delivery["lease_until"] != now + 60:
            return False
        attempts = delivery["attempts"] + 1
        c.execute(
            "UPDATE research_deliveries SET status=?,attempts=?,next_attempt=?,lease_until=0,last_error=? WHERE event_id=? AND recipient=?",
            (
                "delivered" if accepted else "pending",
                attempts,
                now + min(3600, 30 * 2 ** min(attempts - 1, 7)),
                "" if accepted else "transport_failure",
                selected["event_id"],
                recipient,
            ),
        )
    return accepted
