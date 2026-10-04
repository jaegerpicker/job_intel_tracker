export const stages = [
  "Prospect",
  "Applied",
  "Screening",
  "Interview",
  "Offer",
  "Closed",
  "Rejected",
  "Withdrawn",
] as const;
export type Stage = (typeof stages)[number];
export type Kind =
  "job" | "note" | "interview" | "research" | "rating" | "filters";
export type Body = {
  [key: string]: unknown;
  company?: string;
  title?: string;
  stage?: Stage;
  text?: string;
};
export interface BoardRecord {
  id: string;
  kind: Kind;
  job: string | null;
  version: number;
  body: Body;
  author: string;
  updated: number;
}
export interface Attachment {
  id: string;
  job: string;
  filename: string;
  version: number;
  author: string;
  timestamp: number;
}
export interface PendingWrite {
  id: string;
  key: string;
  payload: Pick<BoardRecord, "kind" | "job" | "version" | "body">;
}
export interface Repository {
  list(): Promise<BoardRecord[]>;
  save(write: PendingWrite): Promise<BoardRecord>;
  attachments(job: string): Promise<Attachment[]>;
}
export class BoardError extends Error {
  constructor(
    public code:
      "conflict" | "unauthorized" | "forbidden" | "network" | "invalid",
    message: string,
  ) {
    super(message);
  }
}
export function parseRecord(value: unknown): BoardRecord {
  if (!value || typeof value !== "object")
    throw new BoardError("invalid", "Invalid server response");
  const r = value as BoardRecord;
  if (
    typeof r.id !== "string" ||
    !["job", "note", "interview", "research", "rating", "filters"].includes(
      r.kind,
    ) ||
    !Number.isInteger(r.version) ||
    r.version < 1 ||
    !(r.job === null || typeof r.job === "string") ||
    !r.body ||
    typeof r.body !== "object" ||
    Array.isArray(r.body) ||
    typeof r.author !== "string" ||
    typeof r.updated !== "number" ||
    !Number.isFinite(r.updated)
  )
    throw new BoardError("invalid", "Invalid server response");
  if (
    r.kind === "job" &&
    (typeof r.body.company !== "string" ||
      typeof r.body.title !== "string" ||
      !stages.includes(r.body.stage as Stage))
  )
    throw new BoardError("invalid", "Invalid job response");
  if (
    r.body.timeline !== undefined &&
    (!Array.isArray(r.body.timeline) ||
      r.body.timeline.some(
        (e) =>
          !e ||
          typeof e !== "object" ||
          !stages.includes(e.stage) ||
          typeof e.at !== "number" ||
          !Number.isFinite(e.at) ||
          typeof e.author !== "string",
      ))
  )
    throw new BoardError("invalid", "Invalid status timeline");
  return r;
}
export function active(record: BoardRecord): boolean {
  return (
    record.kind === "job" &&
    !record.body.primary_id &&
    !["Prospect", "Closed", "Rejected", "Withdrawn"].includes(
      record.body.stage ?? "",
    )
  );
}
export function filterJobs(
  records: BoardRecord[],
  query: string,
  stage: string,
): BoardRecord[] {
  const q = query.trim().toLowerCase();
  return records.filter(
    (r) =>
      r.kind === "job" &&
      (stage === "All" || r.body.stage === stage) &&
      `${r.body.company} ${r.body.title} ${r.body.lane ?? ""}`
        .toLowerCase()
        .includes(q),
  );
}
export function prepareWrite(
  record: BoardRecord,
  patch: Body,
  key: string,
): PendingWrite {
  return {
    id: record.id,
    key,
    payload: {
      kind: record.kind,
      job: record.job,
      version: record.version,
      body: { ...record.body, ...patch },
    },
  };
}
export function safeSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function validateFile(name: string, bytes: number): boolean {
  return (
    !/[\\/\u0000-\u001f]/.test(name) &&
    /\.(pdf|txt|docx)$/i.test(name) &&
    bytes > 0 &&
    bytes <= 5 * 1024 * 1024
  );
}
