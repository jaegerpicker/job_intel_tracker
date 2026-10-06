import { parseWorkload } from "./planning";
import {
  parseResearchRequest,
  ResearchOperation,
  validResearchOperation,
} from "./research";
import {
  Attachment,
  BoardError,
  PendingWrite,
  Repository,
  parseRecord,
} from "./domain";
// Live mode uses this through an owner-only, read-only runtime boundary.
// Credentials are supplied by an ephemeral session provider, never build variables.
export class ApiRepository implements Repository {
  constructor(
    private base: string,
    private authorize: () => Promise<Record<string, string>>,
    private transport: typeof fetch = fetch,
  ) {
    const u = new URL(base);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/"
    )
      throw new Error("Use an HTTPS origin without credentials");
  }
  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.transport(new URL(path, this.base), {
        ...init,
        credentials: "omit",
        signal: controller.signal,
        headers: { ...(await this.authorize()), ...init.headers },
      });
      if (!response.ok) {
        const code =
          response.status === 409
            ? "conflict"
            : response.status === 401
              ? "unauthorized"
              : response.status === 403
                ? "forbidden"
                : "invalid";
        // Never echo a server body: it can contain private records or untrusted text.
        throw new BoardError(
          code,
          code === "conflict"
            ? "This record changed or a policy limit was reached. Reload and review before saving."
            : code === "unauthorized"
              ? "Session expired. Sign in again."
              : code === "forbidden"
                ? "This session does not have permission."
                : "The server could not accept this request.",
        );
      }
      return await response.json();
    } catch (error) {
      if (error instanceof BoardError) throw error;
      throw new BoardError(
        "network",
        "Connection interrupted. Retry the same pending operation.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  async identity(): Promise<{ actor: string }> {
    const data = await this.request("/api/me");
    if (
      !data ||
      typeof data !== "object" ||
      typeof (data as { actor?: unknown }).actor !== "string"
    )
      throw new BoardError("invalid", "Invalid identity response");
    return { actor: (data as { actor: string }).actor };
  }
  async list() {
    const data = await this.request("/api/records");
    if (!Array.isArray(data))
      throw new BoardError("invalid", "Invalid record list");
    return data.map(parseRecord);
  }
  async workload() {
    return parseWorkload(await this.request("/api/workload"));
  }
  async researchRequests(job: string) {
    const data = await this.request(
      `/api/research-requests?job=${encodeURIComponent(job)}`,
    );
    if (!Array.isArray(data))
      throw new BoardError("invalid", "Invalid research queue response.");
    const rows = data.map((v) => parseResearchRequest(v, job));
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw new BoardError("invalid", "Invalid research queue response.");
    return rows;
  }
  async researchWrite(operation: ResearchOperation) {
    if (!validResearchOperation(operation))
      throw new BoardError(
        "forbidden",
        "Only owner request, cancel and requeue operations are supported.",
      );
    const path =
      operation.action === "request"
        ? `/api/jobs/${encodeURIComponent(operation.job)}/research-requests`
        : `/api/research-requests/${encodeURIComponent(operation.id)}/${operation.action}`;
    return parseResearchRequest(
      await this.request(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": operation.key,
        },
        body: JSON.stringify(operation.payload),
      }),
      operation.job,
    );
  }
  async save(write: PendingWrite) {
    return parseRecord(
      await this.request(`/api/records/${encodeURIComponent(write.id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": write.key,
        },
        body: JSON.stringify(write.payload),
      }),
    );
  }
  async attachments(job: string): Promise<Attachment[]> {
    const data = await this.request(
      `/api/jobs/${encodeURIComponent(job)}/attachments`,
    );
    if (
      !Array.isArray(data) ||
      data.some(
        (a) =>
          !a ||
          typeof a.id !== "string" ||
          a.job !== job ||
          typeof a.filename !== "string" ||
          !Number.isInteger(a.version) ||
          typeof a.author !== "string" ||
          typeof a.timestamp !== "number",
      )
    )
      throw new BoardError("invalid", "Invalid attachment list");
    return data;
  }
}
