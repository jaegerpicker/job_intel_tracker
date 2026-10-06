import { ApiRepository } from "../src/api";
import { DemoRepository, fixtures } from "../src/demo";
import { BoardError, prepareWrite } from "../src/domain";
import { JournalRepository, SecureWriteJournal } from "../src/journal";
import {
  parseResearchRequest,
  ResearchOperation,
  validResearchOperation,
} from "../src/research";
import { createRuntime } from "../src/runtime";
import { createHash } from "node:crypto";
const operation: ResearchOperation = {
  key: "synthetic-key",
  job: "demo-fern",
  action: "request",
  payload: { package: "full_package", note: "Synthetic instructions" },
};
const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
function journal<T>(validate: (v: unknown) => v is T) {
  const data = new Map<string, string>();
  const store = {
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: string) => {
      data.set(k, v);
    },
    remove: async (k: string) => {
      data.delete(k);
    },
  };
  return new SecureWriteJournal<T>(
    store,
    "https://example.com",
    hash,
    validate,
  );
}
test("actual typed queue parsing rejects mixed jobs, malformed enums, timestamps and artifacts", async () => {
  const repo = new DemoRepository();
  const [row] = await repo.researchRequests("demo-cedar");
  expect(parseResearchRequest(row, row.job)).toEqual(row);
  expect(() => parseResearchRequest(row, "other-job")).toThrow();
  for (const patch of [
    { status: ["queued"] },
    { package: ["research"] },
    {
      events: [
        {
          actor: "a",
          action: "claim",
          version: 1,
          timestamp: 1e300,
          reason: "",
        },
      ],
    },
    { missing_deliverables: ["not-real"] },
    { artifacts: [{ ...row.artifacts[0], observed_on: "2026-02-30" }] },
  ])
    expect(() => parseResearchRequest({ ...row, ...patch })).toThrow();
});
test("owner API rejects agent actions before transport and uses exact contract paths/keys", async () => {
  const demo = new DemoRepository(),
    row = await demo.researchWrite(operation);
  const transport = jest.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => row,
    }),
  );
  const api = new ApiRepository(
    "https://example.com",
    async () => ({ Authorization: "Bearer synthetic-inert" }),
    transport as unknown as typeof fetch,
  );
  expect(await api.researchWrite(operation)).toEqual(row);
  expect(String(transport.mock.calls[0][0])).toBe(
    "https://example.com/api/jobs/demo-fern/research-requests",
  );
  expect(transport.mock.calls[0][1]).toMatchObject({
    credentials: "omit",
    method: "POST",
    body: JSON.stringify(operation.payload),
    headers: { "Idempotency-Key": operation.key },
  });
  await expect(
    api.researchWrite({ ...operation, action: "claim" } as never),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(transport).toHaveBeenCalledTimes(1);
});
test("secure research journal freezes ambiguous writes and retries original body/key across reconstruction", async () => {
  const demo = new DemoRepository(),
    researchJournal = journal(validResearchOperation);
  const recordJournal = {
    read: async () => null,
    put: async () => {},
    clear: async () => {},
  };
  const owner = new JournalRepository(
    demo,
    recordJournal,
    () => {},
    researchJournal,
  );
  demo.research.loseNextResponse = true;
  await expect(owner.researchWrite(operation)).rejects.toMatchObject({
    code: "network",
  });
  expect(await researchJournal.read()).toEqual(operation);
  await expect(
    owner.researchWrite({ ...operation, key: "another-key" }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    owner.save(
      prepareWrite(fixtures[0], { title: "Unrelated edit" }, "record-key"),
    ),
  ).rejects.toMatchObject({ code: "conflict" });
  const restored = new JournalRepository(
    demo,
    recordJournal,
    () => {},
    researchJournal,
  );
  const result = await restored.researchWrite((await researchJournal.read())!);
  expect(result.version).toBe(1);
  expect(await demo.researchRequests(operation.job)).toHaveLength(1);
  expect(await researchJournal.read()).toBeNull();
});
test("fresh action persists before preflight conflict so secure recovery remains available", async () => {
  const demo = new DemoRepository(),
    researchJournal = journal(validResearchOperation);
  const owner = new JournalRepository(
    demo,
    { read: async () => null, put: async () => {}, clear: async () => {} },
    () => {},
    researchJournal,
  );
  const [blocked] = await demo.researchRequests("demo-orbit");
  const stale: ResearchOperation = {
    key: "stale-action",
    job: blocked.job,
    id: blocked.id,
    action: "cancel",
    payload: { version: blocked.version + 1 },
  };
  await expect(owner.researchWrite(stale)).rejects.toMatchObject({
    code: "conflict",
  });
  expect(await researchJournal.read()).toEqual(stale);
  await researchJournal.clear();
  demo.research.loseNextResponse = true;
  const cancel = {
    ...stale,
    key: "cancel-action",
    payload: { version: blocked.version },
  };
  await expect(owner.researchWrite(cancel)).rejects.toMatchObject({
    code: "network",
  });
  const confirmed = await owner.researchWrite(cancel);
  expect(confirmed.status).toBe("cancelled");
  expect(confirmed.version).toBe(blocked.version + 1);
});
test("owner identity and expired session guard research reads and writes", async () => {
  const invalidate = jest.fn(),
    transport = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ actor: "agent:synthetic" }),
    }));
  const runtime = createRuntime({
    mode: "live",
    origin: "https://example.com",
    now: () => 1,
    session: {
      origin: "https://example.com",
      expiresAt: 60000,
      headers: async () => ({ Authorization: "Bearer inert" }),
      invalidate,
    },
    transport: transport as unknown as typeof fetch,
  });
  await expect(
    runtime.repository.researchRequests!("demo-fern"),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(invalidate).toHaveBeenCalledTimes(1);
  await expect(
    runtime.repository.researchRequests!("demo-fern"),
  ).rejects.toMatchObject({ code: "unauthorized" });
  expect(transport).toHaveBeenCalledTimes(1);
  const guard = jest.fn(() => {
    throw new BoardError("unauthorized", "Expired");
  });
  const j = journal(validResearchOperation);
  const owner = new JournalRepository(
    new DemoRepository(),
    { read: async () => null, put: async () => {}, clear: async () => {} },
    guard,
    j,
  );
  await expect(owner.researchWrite(operation)).rejects.toMatchObject({
    code: "unauthorized",
  });
  expect(await j.read()).toBeNull();
});
test("duplicate requests preserve owner note; different package conflicts; blocked work can requeue", async () => {
  const demo = new DemoRepository(),
    initial = await demo.researchWrite(operation);
  expect(
    await demo.researchWrite({
      ...operation,
      key: "fresh-key",
      payload: { ...operation.payload, note: "Do not overwrite" },
    }),
  ).toEqual(initial);
  await expect(
    demo.researchWrite({
      ...operation,
      key: "different",
      payload: { package: "research", note: "" },
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  const [blocked] = await demo.researchRequests("demo-orbit");
  expect(
    (
      await demo.researchWrite({
        action: "requeue",
        job: blocked.job,
        id: blocked.id,
        key: "requeue",
        payload: { version: blocked.version },
      })
    ).status,
  ).toBe("queued");
});
