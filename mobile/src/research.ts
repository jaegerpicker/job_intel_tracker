import { BoardError } from "./domain";
export const packages = [
  "research",
  "application_documents",
  "interview_prep",
  "full_package",
] as const;
export type ResearchPackage = (typeof packages)[number];
export const deliverables = [
  "research",
  "resume",
  "cover_letter",
  "interview_prep",
] as const;
export type Deliverable = (typeof deliverables)[number];
export const packageDeliverables: Record<ResearchPackage, Deliverable[]> = {
  research: ["research"],
  application_documents: ["resume", "cover_letter"],
  interview_prep: ["interview_prep"],
  full_package: [...deliverables],
};
export type ResearchArtifact = {
  deliverable: Deliverable;
  type: "record" | "attachment";
  id: string;
  version: number;
  source: string;
  observed_on: string;
  availability: "available" | "missing" | "changed" | "invalid";
};
export type ResearchRequest = {
  id: string;
  job: string;
  version: number;
  package: ResearchPackage;
  note: string;
  status: "queued" | "claimed" | "completed" | "blocked" | "cancelled";
  created_by: string;
  created_at: number;
  updated_by: string;
  updated_at: number;
  claimed_by: string | null;
  lease_until: number | null;
  claim_expired: boolean;
  reason: string;
  completion_note: string;
  completed_at: number | null;
  artifacts: ResearchArtifact[];
  required_deliverables: Deliverable[];
  missing_deliverables: Deliverable[];
  events: {
    actor: string;
    action: string;
    version: number;
    timestamp: number;
    reason: string;
  }[];
};
export type ResearchOperation = { key: string; job: string } & (
  | { action: "request"; payload: { package: ResearchPackage; note: string } }
  | { action: "cancel" | "requeue"; id: string; payload: { version: number } }
);
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const positive = (v: unknown): v is number =>
  Number.isInteger(v) && Number(v) > 0;
const timestamp = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 253402300800;
const date = (v: unknown) =>
  str(v) &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export function validResearchOperation(v: unknown): v is ResearchOperation {
  if (
    !obj(v) ||
    !str(v.key) ||
    !v.key ||
    !str(v.job) ||
    !v.job ||
    !obj(v.payload)
  )
    return false;
  if (v.action === "request")
    return (
      packages.includes(v.payload.package as ResearchPackage) &&
      str(v.payload.note) &&
      v.payload.note.length <= 4000 &&
      Object.keys(v.payload).every((k) => ["package", "note"].includes(k))
    );
  return (
    ["cancel", "requeue"].includes(v.action as string) &&
    str(v.id) &&
    !!v.id &&
    positive(v.payload.version) &&
    Object.keys(v.payload).length === 1
  );
}
export function parseResearchRequest(
  v: unknown,
  job?: string,
): ResearchRequest {
  const invalid = () => {
    throw new BoardError("invalid", "Invalid research queue response.");
  };
  if (
    !obj(v) ||
    !str(v.id) ||
    !v.id ||
    !str(v.job) ||
    !v.job ||
    (job && v.job !== job) ||
    !positive(v.version) ||
    !packages.includes(v.package as ResearchPackage) ||
    !["queued", "claimed", "completed", "blocked", "cancelled"].includes(
      v.status as string,
    ) ||
    !str(v.status)
  )
    return invalid();
  for (const k of [
    "note",
    "created_by",
    "updated_by",
    "reason",
    "completion_note",
  ])
    if (!str(v[k])) return invalid();
  for (const k of ["created_at", "updated_at"])
    if (!timestamp(v[k])) return invalid();
  for (const k of ["lease_until", "completed_at"])
    if (!(v[k] === null || timestamp(v[k]))) return invalid();
  if (
    !(v.claimed_by === null || str(v.claimed_by)) ||
    typeof v.claim_expired !== "boolean"
  )
    return invalid();
  for (const k of ["required_deliverables", "missing_deliverables"])
    if (
      !Array.isArray(v[k]) ||
      (v[k] as unknown[]).some(
        (d) => !str(d) || !deliverables.includes(d as Deliverable),
      ) ||
      new Set(v[k] as unknown[]).size !== (v[k] as unknown[]).length
    )
      return invalid();
  const expected = packageDeliverables[v.package as ResearchPackage];
  if (
    expected.length !== (v.required_deliverables as string[]).length ||
    expected.some((d) => !(v.required_deliverables as string[]).includes(d)) ||
    (v.missing_deliverables as string[]).some(
      (d) => !expected.includes(d as Deliverable),
    )
  )
    return invalid();
  if (
    !Array.isArray(v.artifacts) ||
    v.artifacts.some(
      (a) =>
        !obj(a) ||
        !str(a.deliverable) ||
        !expected.includes(a.deliverable as Deliverable) ||
        !["record", "attachment"].includes(a.type as string) ||
        !str(a.type) ||
        !str(a.id) ||
        !a.id ||
        !positive(a.version) ||
        !str(a.source) ||
        !date(a.observed_on) ||
        !str(a.availability) ||
        !["available", "missing", "changed", "invalid"].includes(
          a.availability,
        ),
    )
  )
    return invalid();
  if (
    !Array.isArray(v.events) ||
    v.events.some(
      (e) =>
        !obj(e) ||
        !str(e.actor) ||
        !str(e.action) ||
        !positive(e.version) ||
        !timestamp(e.timestamp) ||
        !str(e.reason),
    )
  )
    return invalid();
  return v as unknown as ResearchRequest;
}
