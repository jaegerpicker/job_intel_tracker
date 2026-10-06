import { BoardError, BoardRecord } from "./domain";
import {
  packageDeliverables,
  ResearchOperation,
  ResearchRequest,
  validResearchOperation,
} from "./research";
const seed = (
  id: string,
  job: string,
  status: ResearchRequest["status"],
  choice: ResearchRequest["package"],
): ResearchRequest => ({
  id,
  job,
  version: 1,
  package: choice,
  status,
  note: "Synthetic demonstration request",
  created_by: "owner",
  created_at: 1791208800,
  updated_by: "owner",
  updated_at: 1791208800,
  claimed_by: null,
  lease_until: null,
  claim_expired: false,
  reason: "",
  completion_note: "",
  completed_at: null,
  artifacts: [],
  required_deliverables: [...packageDeliverables[choice]],
  missing_deliverables: [...packageDeliverables[choice]],
  events: [
    {
      actor: "owner",
      action: "request",
      version: 1,
      timestamp: 1791208800,
      reason: "",
    },
  ],
});
export class DemoResearch {
  private rows: ResearchRequest[] = [
    {
      ...seed("demo-request-cedar", "demo-cedar", "completed", "research"),
      completed_at: 1791209900,
      updated_by: "research-agent",
      completion_note: "Synthetic research artifact delivered",
      missing_deliverables: [],
      artifacts: [
        {
          deliverable: "research",
          type: "record",
          id: "demo-research",
          version: 1,
          source: "https://example.com/cedar",
          observed_on: "2026-10-03",
          availability: "available",
        },
      ],
    },
    {
      ...seed(
        "demo-request-orbit",
        "demo-orbit",
        "blocked",
        "application_documents",
      ),
      updated_by: "synthetic-agent",
      reason:
        "Synthetic blocker: owner background/resume source material needed.",
    },
    seed("demo-request-canvas", "demo-canvas", "queued", "full_package"),
  ];
  private receipts = new Map<
    string,
    { fingerprint: string; request: ResearchRequest }
  >();
  private sequence = 0;
  loseNextResponse = false;
  list(job: string, records: BoardRecord[]) {
    return structuredClone(
      this.rows
        .filter((r) => r.job === job)
        .map((r) => {
          const artifacts = r.artifacts.map((a) => {
            const record = records.find((v) => v.id === a.id && v.job === job);
            return {
              ...a,
              availability: (a.type === "record"
                ? !record
                  ? "missing"
                  : record.version !== a.version
                    ? "changed"
                    : "available"
                : a.availability) as typeof a.availability,
            };
          });
          return {
            ...r,
            artifacts,
            missing_deliverables: r.required_deliverables.filter(
              (d) =>
                !artifacts.some(
                  (a) => a.deliverable === d && a.availability === "available",
                ),
            ),
          };
        }),
    );
  }
  write(operation: ResearchOperation, records: BoardRecord[]) {
    if (!validResearchOperation(operation))
      throw new BoardError(
        "forbidden",
        "Unsupported owner research operation.",
      );
    if (!records.some((r) => r.kind === "job" && r.id === operation.job))
      throw new BoardError("invalid", "Job unavailable.");
    const fingerprint = JSON.stringify(operation),
      cached = this.receipts.get(operation.key);
    if (cached) {
      if (cached.fingerprint !== fingerprint)
        throw new BoardError("conflict", "Operation key reused.");
      return structuredClone(cached.request);
    }
    let result: ResearchRequest;
    if (operation.action === "request") {
      const existing = this.rows.find(
        (r) =>
          r.job === operation.job &&
          ["queued", "claimed", "blocked"].includes(r.status),
      );
      if (existing && existing.package !== operation.payload.package)
        throw new BoardError(
          "conflict",
          "A different package is already active.",
        );
      result = existing ?? {
        ...seed(
          `demo-request-${++this.sequence}`,
          operation.job,
          "queued",
          operation.payload.package,
        ),
        note: operation.payload.note,
      };
      if (!existing) this.rows.push(result);
    } else {
      const old = this.rows.find(
        (r) => r.id === operation.id && r.job === operation.job,
      );
      if (!old || old.version !== operation.payload.version)
        throw new BoardError("conflict", "Research progress changed.");
      if (
        (operation.action === "requeue" && old.status !== "blocked") ||
        (operation.action === "cancel" &&
          !["queued", "claimed", "blocked"].includes(old.status))
      )
        throw new BoardError("conflict", "Request transition unavailable.");
      result = {
        ...old,
        version: old.version + 1,
        status: operation.action === "cancel" ? "cancelled" : "queued",
        claimed_by: null,
        lease_until: null,
        reason: "",
        updated_by: "owner",
        updated_at: Date.now() / 1000,
      };
      result.events = [
        ...old.events,
        {
          actor: "owner",
          action: operation.action,
          version: result.version,
          timestamp: result.updated_at,
          reason: "",
        },
      ];
      this.rows = this.rows.map((r) => (r.id === old.id ? result : r));
    }
    this.receipts.set(operation.key, {
      fingerprint,
      request: structuredClone(result),
    });
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new BoardError("network", "Synthetic acknowledgement lost.");
    }
    return structuredClone(result);
  }
}
