"""Date-based planning projections. Observations never imply authority or outreach."""

import re
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
TERMINAL = {"Closed", "Rejected", "Withdrawn"}
DEFAULTS = {
    "open_application_limit": 15,
    "weekly_new_limit": 2,
    "interviewing_company_limit": 3,
    "waiting_days": 7,
    "review_days": 14,
    "promise_grace_business_days": 2,
    "timezone": "America/New_York",
    "business_holidays": [],
    "pilot_days": 14,
    "pilot_started_on": None,
}


class Dated(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def dates(cls, value, info):
        if (
            info.field_name in {"on", "due_on", "applied_on", "shortlisted_on", "interview_on", "promised_response_on"}
            and value is not None
            and (not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value))
        ):
            raise ValueError("Use YYYY-MM-DD dates, or null when unknown")
        return value


class Contact(Dated):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    on: date
    kind: Literal["human", "receipt", "outbound"]
    source: Text
    summary: str = Field(default="", max_length=4000)


class NextAction(Dated):
    text: Text
    owner: Literal["owner", "company", "agent"]
    assignee: str = Field(default="", max_length=100)
    due_on: date | None = None
    source: Text


class Review(Dated):
    decision: Literal["keep_waiting", "prepare_follow_up", "park"]
    on: date
    source: Text
    note: str = Field(default="", max_length=4000)


class Tracking(Dated):
    applied_on: date | None = None
    applied_source: str = Field(default="", max_length=2000)
    shortlisted_on: date | None = None
    shortlisted_source: str = Field(default="", max_length=2000)
    contacts: list[Contact] = Field(default_factory=list, max_length=200)
    interview_on: date | None = None
    interview_source: str = Field(default="", max_length=2000)
    promised_response_on: date | None = None
    promise_source: str = Field(default="", max_length=2000)
    next_action: NextAction | None = None
    review: Review | None = None

    @model_validator(mode="after")
    def provenance(self):
        for observation, source in (
            (self.applied_on, self.applied_source),
            (self.shortlisted_on, self.shortlisted_source),
            (self.interview_on, self.interview_source),
            (self.promised_response_on, self.promise_source),
        ):
            if observation is not None and not source.strip():
                raise ValueError("Each dated observation requires source provenance")
        if len({c.id for c in self.contacts}) != len(self.contacts):
            raise ValueError("Contact IDs must be unique")
        return self


class DerivedJob(BaseModel):
    record_version: int = 0
    status: Literal[
        "terminal",
        "backlog",
        "action_due",
        "action_needed",
        "parked",
        "interview_scheduled",
        "interview_review",
        "promise_waiting",
        "promise_review",
        "dates_unknown",
        "waiting",
        "waiting_badge",
        "review_due",
        "offer_review",
    ]
    label: str
    waiting_days: int | None = None
    needs_decision: bool = False
    reasons: list[str] = Field(default_factory=list)
    next_action: NextAction | None = None
    review_on: date | None = None
    tracking: Tracking = Field(default_factory=Tracking)


class Decision(BaseModel):
    job_id: str
    company: str
    title: str
    status: str
    label: str
    reasons: list[str]
    next_action: NextAction | None = None


class Counts(BaseModel):
    open_applications: int
    passive_waiting: int
    attention: int
    parked: int
    interviewing_companies: int
    weekly_new: int
    unknown_application_dates: int


class Warning(BaseModel):
    code: str
    message: str


class WorkloadResponse(BaseModel):
    as_of: datetime
    local_date: date
    timezone: str
    policy: dict
    counts: Counts
    warnings: list[Warning]
    jobs: dict[str, DerivedJob]
    decisions: list[Decision]


def normalized_policy(body):
    return {**DEFAULTS, **body}


def validate_policy(body):
    p = normalized_policy(body)
    for key, maximum in (
        ("open_application_limit", 100),
        ("weekly_new_limit", 100),
        ("interviewing_company_limit", 100),
        ("waiting_days", 365),
        ("review_days", 365),
        ("promise_grace_business_days", 30),
        ("pilot_days", 90),
    ):
        if type(p[key]) is not int or not 1 <= p[key] <= maximum:
            raise ValueError("Invalid planning threshold")
    if p["review_days"] < p["waiting_days"]:
        raise ValueError("Review threshold must be at least the waiting threshold")
    if not isinstance(p["timezone"], str):
        raise TypeError("Invalid IANA timezone")
    ZoneInfo(p["timezone"])
    if not isinstance(p["business_holidays"], list) or len(p["business_holidays"]) > 366:
        raise ValueError("Use a list of up to 366 business holidays")
    if any(not isinstance(value, str) for value in p["business_holidays"]):
        raise ValueError("Each business holiday must be a YYYY-MM-DD date")
    for value in [*p["business_holidays"], p["pilot_started_on"]]:
        if value is not None:
            if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                raise ValueError("Use YYYY-MM-DD policy dates")
            date.fromisoformat(value)
    return p


def effective_policy(body):
    try:
        return validate_policy(body), False
    except (ValueError, TypeError, KeyError):
        return normalized_policy({k: v for k, v in body.items() if k not in DEFAULTS}), True


def parse_tracking(body, today):
    raw = body.get("tracking")
    tracking = Tracking.model_validate({} if raw is None else raw)
    actual = [tracking.applied_on, tracking.shortlisted_on, *(c.on for c in tracking.contacts)]
    if tracking.review:
        actual.append(tracking.review.on)
    if any(on and on > today for on in actual):
        raise ValueError("Actual observations and reviews cannot be future-dated")
    return tracking


def business_date(start, days, holidays):
    current = start
    for _ in range(days):
        try:
            current += timedelta(days=1)
            while current.weekday() >= 5 or current.isoformat() in holidays:
                current += timedelta(days=1)
        except OverflowError:
            return date.max
    return current


def derive(body, policy, today):
    try:
        t = parse_tracking(body, today)
    except (ValueError, TypeError):
        if body.get("stage") in TERMINAL | {"Prospect"}:
            return DerivedJob(
                status="terminal" if body.get("stage") in TERMINAL else "backlog",
                label="Tracking dates unknown",
                reasons=["Invalid legacy tracking; no dates inferred"],
            )
        return DerivedJob(
            status="dates_unknown",
            label="Check tracking dates and provenance",
            needs_decision=True,
            reasons=["Invalid legacy tracking; no dates inferred"],
        )
    result = DerivedJob(status="waiting", label="Waiting", tracking=t, next_action=t.next_action)
    if body.get("stage") in TERMINAL:
        result.status, result.label = "terminal", "Closed opportunity"
        return result
    if body.get("stage") == "Prospect":
        result.status, result.label = "backlog", "Unapplied backlog"
        if t.next_action and t.next_action.owner in ("owner", "agent"):
            result.status, result.label = "action_needed", t.next_action.text
            result.needs_decision = not t.next_action.due_on or t.next_action.due_on <= today
        return result
    human = max((c.on for c in t.contacts if c.kind == "human"), default=None)
    anchor = human or t.applied_on
    if t.applied_on and human:
        anchor = max(t.applied_on, human)
    result.waiting_days = (today - anchor).days if anchor else None
    if t.next_action and t.next_action.owner in ("owner", "agent"):
        due = t.next_action.due_on
        result.status = "action_due" if due and due <= today else "action_needed"
        result.label = t.next_action.text
        result.needs_decision = not due or due <= today
        result.reasons = ["Next action belongs to the owner or an assigned agent; company aging is suppressed"]
        return result
    if t.review and t.review.decision == "park":
        result.status, result.label = "parked", "Parked by owner; application remains open"
        return result
    if t.review and t.review.decision == "prepare_follow_up":
        result.status, result.label, result.needs_decision = "action_needed", "Prepare follow-up; no message sent", True
        result.reasons = ["Owner chose preparation, not automated outreach"]
        return result
    if t.interview_on:
        if t.interview_on >= today:
            result.status, result.label = "interview_scheduled", "Interview scheduled " + t.interview_on.isoformat()
            return result
        if not (human and human > t.interview_on) and not (t.review and t.review.on >= t.interview_on):
            result.status, result.label, result.needs_decision = (
                "interview_review",
                "Interview date passed; confirm next step",
                True,
            )
            return result
    if t.promised_response_on and not (human and human >= t.promised_response_on):
        result.review_on = business_date(
            t.promised_response_on, policy["promise_grace_business_days"], policy["business_holidays"]
        )
        if today < result.review_on:
            result.status, result.label = "promise_waiting", "Response promised " + t.promised_response_on.isoformat()
            return result
        if not (t.review and t.review.on >= result.review_on):
            result.status, result.label, result.needs_decision = (
                "promise_review",
                "Promised response missed; review next step",
                True,
            )
            return result
    if body.get("stage") == "Offer" and not t.next_action:
        result.status, result.label, result.needs_decision = "offer_review", "Offer: choose the next action", True
        return result
    if anchor is None:
        result.status, result.label, result.needs_decision = (
            "dates_unknown",
            "Application / human-contact date unknown",
            True,
        )
        result.reasons = ["Add a sourced date only if known; record and timeline timestamps are not evidence"]
        if t.review and t.review.decision == "keep_waiting":
            result.review_on = t.review.on + timedelta(days=policy["review_days"])
            result.needs_decision = today >= result.review_on
            result.label = "Dates unknown; owner waiting review " + result.review_on.isoformat()
        return result
    result.review_on = anchor + timedelta(days=policy["review_days"])
    if t.review and t.review.decision == "keep_waiting":
        result.review_on = max(result.review_on, t.review.on + timedelta(days=policy["review_days"]))
    if today >= result.review_on:
        result.status, result.label, result.needs_decision = (
            "review_due",
            "Review waiting: keep, prepare follow-up or park",
            True,
        )
        result.reasons = ["No automatic rejection, archive or outreach"]
    elif result.waiting_days is not None and result.waiting_days >= policy["waiting_days"]:
        result.status, result.label = "waiting_badge", f"Waiting {result.waiting_days} days"
    else:
        result.label = f"Waiting {result.waiting_days} days"
    return result


def project(records, raw_policy, now=None):
    now = now or datetime.now(UTC)
    policy, invalid_policy = effective_policy(raw_policy)
    today = now.astimezone(ZoneInfo(policy["timezone"])).date()
    jobs = [r for r in records if r["kind"] == "job"]
    states = {r["id"]: derive(r["body"], policy, today) for r in jobs}
    for r in jobs:
        states[r["id"]].record_version = r["version"]
    opened = [r for r in jobs if r["body"]["stage"] not in TERMINAL | {"Prospect"}]
    parked = sum(states[r["id"]].status == "parked" for r in opened)
    attention = sum(
        states[r["id"]].status != "parked"
        and (
            r["body"]["stage"] == "Interview"
            or states[r["id"]].needs_decision
            or states[r["id"]].status in {"action_needed", "action_due", "interview_scheduled"}
        )
        for r in opened
    )
    interviewing = len(
        {
            r["body"]["company"].strip().casefold()
            for r in opened
            if r["body"]["stage"] == "Interview"
            or (states[r["id"]].tracking.interview_on and states[r["id"]].tracking.interview_on >= today)
        }
    )
    week = today - timedelta(days=today.weekday())
    weekly = sum(
        any(
            on and week <= on <= today
            for on in (states[r["id"]].tracking.applied_on, states[r["id"]].tracking.shortlisted_on)
        )
        for r in jobs
    )
    counts = Counts(
        open_applications=len(opened),
        passive_waiting=len(opened) - attention - parked,
        attention=attention,
        parked=parked,
        interviewing_companies=interviewing,
        weekly_new=weekly,
        unknown_application_dates=sum(states[r["id"]].tracking.applied_on is None for r in opened),
    )
    warnings = []
    if invalid_policy:
        warnings.append(
            Warning(
                code="policy_invalid", message="Legacy planning settings need owner review; safe defaults are shown."
            )
        )
    for value, limit, code, label in (
        (len(opened), policy["open_application_limit"], "open_applications", "open applications"),
        (weekly, policy["weekly_new_limit"], "weekly_new", "new strong matches / applications this week"),
        (
            interviewing,
            policy["interviewing_company_limit"],
            "interviewing_companies",
            "companies actively interviewing",
        ),
    ):
        if value >= limit:
            warnings.append(
                Warning(code=code, message=f"{value} {label}; planning threshold {limit}. Recording remains available.")
            )
    if (
        policy["pilot_started_on"]
        and date.fromisoformat(policy["pilot_started_on"]) <= today
        and today >= date.fromisoformat(policy["pilot_started_on"]) + timedelta(days=policy["pilot_days"])
    ):
        warnings.append(
            Warning(
                code="pilot_review",
                message="Capacity pilot is due for owner review; no policy changed automatically.",
            )
        )
    decisions = [
        Decision(
            job_id=r["id"],
            company=r["body"]["company"],
            title=r["body"]["title"],
            status=states[r["id"]].status,
            label=states[r["id"]].label,
            reasons=states[r["id"]].reasons,
            next_action=states[r["id"]].next_action,
        )
        for r in jobs
        if states[r["id"]].needs_decision
    ]
    return WorkloadResponse(
        as_of=now,
        local_date=today,
        timezone=policy["timezone"],
        policy=policy,
        counts=counts,
        warnings=warnings,
        jobs=states,
        decisions=decisions,
    )
