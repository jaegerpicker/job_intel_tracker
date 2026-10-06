// Synthetic demo only. Live clients always display the server's projection.
import { BoardRecord } from "./domain";
import {
  DerivedJob,
  Tracking,
  Workload,
  parseTracking,
  parseWorkload,
} from "./planning";
const defaults = {
  open_application_limit: 15,
  weekly_new_limit: 2,
  interviewing_company_limit: 3,
  waiting_days: 7,
  review_days: 14,
  promise_grace_business_days: 2,
  timezone: "America/New_York",
  business_holidays: [] as string[],
  pilot_days: 14,
  pilot_started_on: null,
};
const day = (date: string) => Date.parse(date + "T00:00:00Z") / 86400000;
const add = (date: string, n: number) =>
  new Date((day(date) + n) * 86400000).toISOString().slice(0, 10);
function derive(r: BoardRecord, today: string): DerivedJob {
  let t: Tracking;
  try {
    t = parseTracking(r.body.tracking ?? {}, today);
  } catch {
    t = {};
  }
  const d: DerivedJob = {
    record_version: r.version,
    status: "waiting",
    label: "Waiting",
    waiting_days: null,
    needs_decision: false,
    reasons: [],
    next_action: t.next_action ?? null,
    review_on: null,
    tracking: t,
  };
  const set = (status: DerivedJob["status"], label: string, decision = false) =>
    Object.assign(d, { status, label, needs_decision: decision });
  if (["Closed", "Rejected", "Withdrawn"].includes(r.body.stage ?? ""))
    return set("terminal", "Closed opportunity");
  const task = t.next_action;
  if (r.body.stage === "Prospect")
    return task && task.owner !== "company"
      ? set("action_needed", task.text, !task.due_on || task.due_on <= today)
      : set("backlog", "Unapplied backlog");
  const human = (t.contacts ?? [])
    .filter((c) => c.kind === "human")
    .map((c) => c.on)
    .sort()
    .at(-1);
  const anchor = [t.applied_on, human]
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);
  d.waiting_days = anchor ? day(today) - day(anchor) : null;
  if (task && task.owner !== "company") {
    d.reasons = [
      "Next action belongs to the owner or an assigned agent; company aging is suppressed",
    ];
    return set(
      task.due_on && task.due_on <= today ? "action_due" : "action_needed",
      task.text,
      !task.due_on || task.due_on <= today,
    );
  }
  if (t.review?.decision === "park")
    return set("parked", "Parked by owner; application remains open");
  if (t.review?.decision === "prepare_follow_up")
    return set("action_needed", "Prepare follow-up; no message sent", true);
  if (t.interview_on) {
    if (t.interview_on >= today)
      return set(
        "interview_scheduled",
        "Interview scheduled " + t.interview_on,
      );
    if (
      !(human && human > t.interview_on) &&
      !(t.review && t.review.on >= t.interview_on)
    )
      return set(
        "interview_review",
        "Interview date passed; confirm next step",
        true,
      );
  }
  if (t.promised_response_on && !(human && human >= t.promised_response_on)) {
    let date = t.promised_response_on,
      left = defaults.promise_grace_business_days;
    while (left) {
      date = add(date, 1);
      const weekday = new Date(date + "T00:00:00Z").getUTCDay();
      if (weekday !== 0 && weekday !== 6) left--;
    }
    d.review_on = date;
    if (today < date)
      return set(
        "promise_waiting",
        "Response promised " + t.promised_response_on,
      );
    if (!(t.review && t.review.on >= date))
      return set(
        "promise_review",
        "Promised response missed; review next step",
        true,
      );
  }
  if (r.body.stage === "Offer" && !task)
    return set("offer_review", "Offer: choose the next action", true);
  if (!anchor) {
    d.reasons = [
      "Add a sourced date only if known; record and timeline timestamps are not evidence",
    ];
    if (t.review?.decision === "keep_waiting") {
      d.review_on = add(t.review.on, 14);
      return set(
        "dates_unknown",
        "Dates unknown; owner waiting review " + d.review_on,
        today >= d.review_on,
      );
    }
    return set(
      "dates_unknown",
      "Application / human-contact date unknown",
      true,
    );
  }
  d.review_on = add(anchor, 14);
  if (t.review?.decision === "keep_waiting")
    d.review_on = [d.review_on, add(t.review.on, 14)].sort().at(-1)!;
  if (today >= d.review_on)
    return set(
      "review_due",
      "Review waiting: keep, prepare follow-up or park",
      true,
    );
  return set(
    d.waiting_days! >= 7 ? "waiting_badge" : "waiting",
    "Waiting " + d.waiting_days + " days",
  );
}
export function demoWorkload(
  records: BoardRecord[],
  today = "2026-10-05",
): Workload {
  const jobs = records.filter((r) => r.kind === "job"),
    states: Record<string, DerivedJob> = {};
  for (const r of jobs) states[r.id] = derive(r, today);
  const opened = jobs.filter(
    (r) =>
      !["Prospect", "Closed", "Rejected", "Withdrawn"].includes(
        r.body.stage ?? "",
      ),
  );
  const parked = opened.filter((r) => states[r.id].status === "parked").length;
  const attention = opened.filter(
    (r) =>
      states[r.id].status !== "parked" &&
      (r.body.stage === "Interview" ||
        states[r.id].needs_decision ||
        ["action_needed", "action_due", "interview_scheduled"].includes(
          states[r.id].status,
        )),
  ).length;
  const weekday = new Date(today + "T00:00:00Z").getUTCDay(),
    monday = add(today, -((weekday + 6) % 7));
  const counts = {
    open_applications: opened.length,
    passive_waiting: opened.length - attention - parked,
    attention,
    parked,
    interviewing_companies: new Set(
      opened
        .filter(
          (r) =>
            r.body.stage === "Interview" ||
            (states[r.id].tracking.interview_on ?? "") >= today,
        )
        .map((r) => r.body.company!.trim().toLowerCase()),
    ).size,
    weekly_new: jobs.filter((r) =>
      [
        states[r.id].tracking.applied_on,
        states[r.id].tracking.shortlisted_on,
      ].some((d) => d && d >= monday && d <= today),
    ).length,
    unknown_application_dates: opened.filter(
      (r) => !states[r.id].tracking.applied_on,
    ).length,
  };
  const warnings: Workload["warnings"] = [];
  for (const [key, limit] of [
    ["open_applications", 15],
    ["interviewing_companies", 3],
    ["weekly_new", 2],
  ] as const)
    if (counts[key] >= limit)
      warnings.push({
        code: key,
        message: `${counts[key]} ${key.replaceAll("_", " ")}; planning threshold ${limit}. Recording remains available.`,
      });
  return parseWorkload({
    as_of: today + "T16:00:00Z",
    local_date: today,
    timezone: defaults.timezone,
    policy: defaults,
    counts,
    warnings,
    jobs: states,
    decisions: jobs
      .filter((r) => states[r.id].needs_decision)
      .map((r) => ({
        job_id: r.id,
        company: r.body.company,
        title: r.body.title,
        status: states[r.id].status,
        label: states[r.id].label,
        reasons: states[r.id].reasons,
        next_action: states[r.id].next_action,
      })),
  });
}
