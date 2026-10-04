import {
  BoardRecord,
  BoardError,
  PendingWrite,
  Repository,
  active,
} from "./domain";
const stamp = 1791028800;
const job = (
  id: string,
  company: string,
  title: string,
  stage: BoardRecord["body"]["stage"],
  extra = {},
): BoardRecord => ({
  id,
  kind: "job",
  job: null,
  version: 1,
  author: "owner",
  updated: stamp,
  body: {
    company,
    title,
    stage,
    lane: "Product engineering",
    route: "Direct application",
    comp_status: "Unknown",
    location: "Remote · US",
    timeline: [
      { stage: "Prospect", at: stamp - 86400, author: "owner" },
      { stage, at: stamp, author: "owner" },
    ],
    ...extra,
  },
});
export const fixtures: BoardRecord[] = [
  job("demo-cedar", "Cedar Studio", "Senior Mobile Engineer", "Interview", {
    base_min: 160000,
    base_max: 190000,
    comp_status: "Listed",
    description:
      "Build thoughtful tools for creative people. Own native interactions, performance, and an accessible writing experience.",
    url: "https://example.com/cedar",
  }),
  job("demo-orbit", "Orbit Works", "Product Engineer", "Screening", {
    description: "A small team making complex workflows feel simple.",
  }),
  job("demo-fern", "Fern Labs", "React Native Engineer", "Prospect"),
  job("demo-canvas", "Canvas Collective", "Staff Software Engineer", "Applied"),
  {
    id: "search-policy",
    kind: "filters",
    job: null,
    version: 1,
    author: "owner",
    updated: stamp,
    body: {
      active_cap: 5,
      base_floor: 150000,
      lanes: ["Product engineering", "Mobile engineering"],
    },
  },
  {
    id: "demo-note",
    kind: "note",
    job: "demo-cedar",
    version: 1,
    author: "owner",
    updated: stamp,
    body: {
      text: "Prepare a concrete example of improving editor responsiveness without losing accessibility.",
    },
  },
  {
    id: "demo-prep",
    kind: "interview",
    job: "demo-cedar",
    version: 1,
    author: "owner",
    updated: stamp,
    body: {
      text: "Ask: how does the team measure writing flow?\nStory: tradeoffs between optimistic updates and conflict safety.",
    },
  },
  {
    id: "demo-research",
    kind: "research",
    job: "demo-cedar",
    version: 1,
    author: "research-agent",
    updated: stamp,
    body: {
      text: "Synthetic listing emphasizes native product quality. Treat this as a demo claim, not verified company research.",
      source: "https://example.com/cedar",
      observed_at: "2026-10-03",
    },
  },
  {
    id: "demo-rating-a",
    kind: "rating",
    job: "demo-cedar",
    version: 1,
    author: "technical-reviewer",
    updated: stamp,
    body: {
      score: 88,
      rationale: "Strong match for native interaction and API design.",
      rubric: "Engineering 60%; product 40%",
      evidence: "Synthetic listing",
    },
  },
  {
    id: "demo-rating-b",
    kind: "rating",
    job: "demo-cedar",
    version: 1,
    author: "role-reviewer",
    updated: stamp,
    body: {
      score: 74,
      rationale: "Scope is promising; clarify ownership and compensation.",
      rubric: "Scope 50%; compensation 50%",
      evidence: "Synthetic listing",
    },
  },
];
export class DemoRepository implements Repository {
  private records = structuredClone(fixtures);
  private completed = new Map<
    string,
    { fingerprint: string; record: BoardRecord }
  >();
  failNext = false;
  private async wait() {
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (this.failNext) {
      this.failNext = false;
      throw new BoardError(
        "network",
        "Demo connection interrupted. Retry to recover.",
      );
    }
  }
  async list() {
    await this.wait();
    return structuredClone(this.records);
  }
  async attachments(job: string) {
    await this.wait();
    return job === "demo-cedar"
      ? [
          {
            id: "demo-file",
            job,
            filename: "synthetic-portfolio.txt",
            version: 1,
            author: "owner",
            timestamp: stamp,
          },
        ]
      : [];
  }
  async save(write: PendingWrite) {
    await this.wait();
    const fingerprint = JSON.stringify({
      id: write.id,
      payload: write.payload,
    });
    const cached = this.completed.get(write.key);
    if (cached) {
      if (cached.fingerprint !== fingerprint)
        throw new BoardError("conflict", "Operation key reused");
      return structuredClone(cached.record);
    }
    const old = this.records.find((r) => r.id === write.id);
    if ((old?.version ?? 0) !== write.payload.version)
      throw new BoardError(
        "conflict",
        "This record changed. Reload and review your draft.",
      );
    const next: BoardRecord = {
      ...structuredClone(write.payload),
      id: write.id,
      version: write.payload.version + 1,
      author: old?.author ?? "owner",
      updated: Date.now() / 1000,
    };
    if (next.kind === "job") {
      if (!next.body.company?.trim() || !next.body.title?.trim())
        throw new BoardError("invalid", "Company and title are required.");
      const cap = Number(
        this.records.find((r) => r.kind === "filters")?.body.active_cap ?? 10,
      );
      if (
        active(next) &&
        (!old || !active(old)) &&
        this.records.filter(active).length >= cap
      )
        throw new BoardError(
          "conflict",
          "Active opportunity limit reached. Review your board.",
        );
      if (!old || old.body.stage !== next.body.stage)
        next.body.timeline = [
          ...(Array.isArray(old?.body.timeline) ? old.body.timeline : []),
          { stage: next.body.stage, at: next.updated, author: "owner" },
        ];
    }
    this.records = [...this.records.filter((r) => r.id !== next.id), next];
    this.completed.set(write.key, {
      fingerprint,
      record: structuredClone(next),
    });
    return structuredClone(next);
  }
}
