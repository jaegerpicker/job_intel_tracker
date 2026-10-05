import { BoardError } from "./domain";
export type ActionOwner = "owner" | "company" | "agent";
export type NextAction = {
  text: string;
  owner: ActionOwner;
  source: string;
  assignee?: string;
  due_on?: string | null;
};
export type Contact = {
  id: string;
  on: string;
  kind: "human" | "receipt" | "outbound";
  source: string;
  summary?: string;
};
export type Review = {
  decision: "keep_waiting" | "prepare_follow_up" | "park";
  on: string;
  source: string;
  note?: string;
};
export type Tracking = {
  applied_on?: string | null;
  applied_source?: string;
  shortlisted_on?: string | null;
  shortlisted_source?: string;
  interview_on?: string | null;
  interview_source?: string;
  promised_response_on?: string | null;
  promise_source?: string;
  contacts?: Contact[];
  next_action?: NextAction | null;
  review?: Review | null;
};
export const attentionStatuses = [
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
] as const;
export type DerivedJob = {
  record_version: number;
  status: (typeof attentionStatuses)[number];
  label: string;
  waiting_days: number | null;
  needs_decision: boolean;
  reasons: string[];
  next_action: NextAction | null;
  review_on: string | null;
  tracking: Tracking;
};
export type Workload = {
  as_of: string;
  local_date: string;
  timezone: string;
  policy: Record<string, unknown>;
  counts: {
    open_applications: number;
    passive_waiting: number;
    attention: number;
    parked: number;
    interviewing_companies: number;
    weekly_new: number;
    unknown_application_dates: number;
  };
  warnings: { code: string; message: string }[];
  jobs: Record<string, DerivedJob>;
  decisions: {
    job_id: string;
    company: string;
    title: string;
    status: DerivedJob["status"];
    label: string;
    reasons: string[];
    next_action: NextAction | null;
  }[];
};
const fail = () => {
  throw new BoardError(
    "invalid",
    "Planning data is invalid. Refresh and review before editing.",
  );
};
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : fail();
const text = (v: unknown, max = 2000, required = false) =>
  typeof v === "string" && v.length <= max && (!required || !!v.trim());
export function isDate(v: unknown): v is string {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    Number(v.slice(0, 4)) < 1
  )
    return false;
  const n = new Date(v + "T00:00:00Z");
  return Number.isFinite(n.getTime()) && n.toISOString().slice(0, 10) === v;
}
const optionalDate = (v: unknown) => v === undefined || v === null || isDate(v);
export function parseAction(v: unknown): NextAction | null {
  if (v === null || v === undefined) return null;
  const a = object(v);
  if (
    Object.keys(a).some(
      (k) => !["text", "owner", "source", "assignee", "due_on"].includes(k),
    )
  )
    fail();
  if (
    !text(a.text, 2000, true) ||
    typeof a.owner !== "string" ||
    !["owner", "company", "agent"].includes(a.owner) ||
    !text(a.source, 2000, true) ||
    !optionalDate(a.due_on) ||
    (a.assignee !== undefined && !text(a.assignee, 100))
  )
    fail();
  return a as NextAction;
}
export function parseTracking(v: unknown, localDate?: string): Tracking {
  const t = object(v);
  if (
    Object.keys(t).some(
      (k) =>
        ![
          "applied_on",
          "applied_source",
          "shortlisted_on",
          "shortlisted_source",
          "interview_on",
          "interview_source",
          "promised_response_on",
          "promise_source",
          "contacts",
          "next_action",
          "review",
        ].includes(k),
    )
  )
    fail();
  for (const [date, source] of [
    ["applied_on", "applied_source"],
    ["shortlisted_on", "shortlisted_source"],
    ["interview_on", "interview_source"],
    ["promised_response_on", "promise_source"],
  ]) {
    if (
      !optionalDate(t[date]) ||
      (t[source] !== undefined && !text(t[source])) ||
      (t[date] && !text(t[source], 2000, true))
    )
      fail();
    if (
      localDate &&
      ["applied_on", "shortlisted_on"].includes(date) &&
      typeof t[date] === "string" &&
      t[date] > localDate
    )
      fail();
  }
  parseAction(t.next_action);
  if (t.contacts !== undefined) {
    if (!Array.isArray(t.contacts) || t.contacts.length > 200) fail();
    const ids = new Set<string>();
    for (const value of t.contacts as unknown[]) {
      const c = object(value);
      if (
        Object.keys(c).some(
          (k) => !["id", "on", "kind", "source", "summary"].includes(k),
        )
      )
        fail();
      if (
        typeof c.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(c.id) ||
        ids.has(c.id) ||
        !isDate(c.on) ||
        (localDate && c.on > localDate) ||
        typeof c.kind !== "string" ||
        !["human", "receipt", "outbound"].includes(c.kind) ||
        !text(c.source, 2000, true) ||
        (c.summary !== undefined && !text(c.summary, 4000))
      )
        fail();
      ids.add(c.id as string);
    }
  }
  if (t.review !== null && t.review !== undefined) {
    const r = object(t.review);
    if (
      Object.keys(r).some(
        (k) => !["decision", "on", "source", "note"].includes(k),
      )
    )
      fail();
    if (
      typeof r.decision !== "string" ||
      !["keep_waiting", "prepare_follow_up", "park"].includes(r.decision) ||
      !isDate(r.on) ||
      (localDate && r.on > localDate) ||
      !text(r.source, 2000, true) ||
      (r.note !== undefined && !text(r.note, 4000))
    )
      fail();
  }
  return t as Tracking;
}
export function parseWorkload(value: unknown): Workload {
  const w = object(value),
    c = object(w.counts),
    jobs = object(w.jobs),
    policy = object(w.policy);
  if (
    !isDate(w.local_date) ||
    typeof w.as_of !== "string" ||
    !Number.isFinite(Date.parse(w.as_of)) ||
    !text(w.timezone, 100, true)
  )
    fail();
  for (const name of [
    "open_applications",
    "passive_waiting",
    "attention",
    "parked",
    "interviewing_companies",
    "weekly_new",
    "unknown_application_dates",
  ])
    if (!Number.isInteger(c[name]) || Number(c[name]) < 0) fail();
  for (const key of [
    "open_application_limit",
    "interviewing_company_limit",
    "weekly_new_limit",
  ])
    if (!Number.isInteger(policy[key]) || Number(policy[key]) < 1) fail();
  if (
    !Array.isArray(w.warnings) ||
    w.warnings.some(
      (x) => !x || !text(x.code, 100, true) || !text(x.message, 4000, true),
    )
  )
    fail();
  for (const value of Object.values(jobs)) {
    const d = object(value);
    if (
      !Number.isInteger(d.record_version) ||
      Number(d.record_version) < 1 ||
      !attentionStatuses.includes(d.status as DerivedJob["status"]) ||
      !text(d.label, 4000, true) ||
      typeof d.needs_decision !== "boolean" ||
      !(
        d.waiting_days === null ||
        (Number.isInteger(d.waiting_days) && Number(d.waiting_days) >= 0)
      ) ||
      !optionalDate(d.review_on) ||
      !Array.isArray(d.reasons) ||
      d.reasons.some((x) => !text(x, 4000, true))
    )
      fail();
    parseAction(d.next_action);
    parseTracking(d.tracking);
  }
  if (!Array.isArray(w.decisions)) fail();
  for (const value of w.decisions as unknown[]) {
    const d = object(value);
    if (
      !text(d.job_id, 200, true) ||
      !text(d.company, 4000, true) ||
      !text(d.title, 4000, true) ||
      !attentionStatuses.includes(d.status as DerivedJob["status"]) ||
      !text(d.label, 4000, true) ||
      !Array.isArray(d.reasons) ||
      d.reasons.some((x) => !text(x, 4000, true))
    )
      fail();
    parseAction(d.next_action);
  }
  return w as Workload;
}
