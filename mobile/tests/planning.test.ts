import { parseTracking, parseWorkload } from "../src/planning";
import { demoWorkload } from "../src/demo-workload";
import { DemoRepository, fixtures } from "../src/demo";
import { ApiRepository } from "../src/api";
import { createRuntime } from "../src/runtime";
import { prepareWrite } from "../src/domain";
const projection = () => demoWorkload(fixtures);
test("workload API uses the existing ephemeral header and validates response", async () => {
  const fetcher = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => projection(),
  });
  const api = new ApiRepository(
    "https://example.com",
    async () => ({ Authorization: "Bearer synthetic" }),
    fetcher,
  );
  expect(await api.workload()).toEqual(projection());
  expect(String(fetcher.mock.calls[0][0])).toBe(
    "https://example.com/api/workload",
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    credentials: "omit",
    headers: { Authorization: "Bearer synthetic" },
  });
  fetcher.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      ...projection(),
      counts: { open_applications: "15" },
    }),
  });
  await expect(api.workload()).rejects.toMatchObject({ code: "invalid" });
});
test.each([
  {},
  { jobs: { bad: { status: "waiting" } } },
  { local_date: "2026-02-30" },
  { warnings: [{ message: 1 }] },
  { decisions: [{}] },
])("malformed workload stays unavailable: %j", (value) => {
  expect(() =>
    parseWorkload({
      ...projection(),
      ...value,
      ...(Object.keys(value).length ? {} : { counts: {} }),
    }),
  ).toThrow();
});
test("owner identity and expiry protect new reads", async () => {
  const invalidate = jest.fn(),
    transport = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ actor: "agent:synthetic" }),
    });
  const runtime = createRuntime({
    mode: "live",
    origin: "https://example.com",
    now: () => 1000,
    session: {
      origin: "https://example.com",
      expiresAt: 61000,
      headers: async () => ({ Authorization: "Bearer synthetic" }),
      invalidate,
    },
    transport,
  });
  await expect(runtime.repository.workload!()).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalled();
  await expect(runtime.repository.workload!()).rejects.toMatchObject({
    code: "unauthorized",
  });
  expect(transport).toHaveBeenCalledTimes(1);
});
test.each([
  { applied_on: "2026-10-01" },
  { applied_on: "2026-02-30", applied_source: "Synthetic" },
  { applied_on: "2026-10-06", applied_source: "Synthetic" },
  { next_action: { text: "Draft", owner: "unknown", source: "Synthetic" } },
  {
    contacts: [
      { id: "a", on: "2026-10-01", kind: "human", source: "Synthetic" },
      { id: "a", on: "2026-10-01", kind: "receipt", source: "Synthetic" },
    ],
  },
])("invalid date/provenance never becomes a write: %j", (t) =>
  expect(() => parseTracking(t, "2026-10-05")).toThrow(),
);
test("capacity is advisory; demo writes retain exact key and unrelated fields", async () => {
  const repo = new DemoRepository();
  const before = (await repo.list())[0];
  const tracking = {
    ...(before.body.tracking as object),
    next_action: {
      text: "Prepare questions",
      owner: "owner",
      due_on: "2026-10-07",
      source: "Synthetic owner plan",
    },
  };
  const write = prepareWrite(before, { tracking }, "synthetic-planning-key");
  const first = await repo.save(write),
    again = await repo.save(write);
  expect(first).toEqual(again);
  expect(first.body.description).toBe(before.body.description);
  expect(first.body.timeline).toEqual(before.body.timeline);
  expect((await repo.workload()).jobs[first.id]).toMatchObject({
    record_version: 2,
    status: "action_needed",
    next_action: tracking.next_action,
  });
});
// Authoritative synthetic responses generated from backend ccf4006, not hand-written expectations.
import cases from "../qa/workload-contract-cases.json";
test.each(cases)("demo and read contract agree: $name", (c) => {
  const actual = demoWorkload(
    c.records as typeof fixtures,
    c.expected.local_date,
  );
  const expected = parseWorkload(c.expected);
  expect(actual.counts).toEqual(expected.counts);
  for (const id of Object.keys(expected.jobs))
    expect(actual.jobs[id]).toMatchObject({
      status: expected.jobs[id].status,
      label: expected.jobs[id].label,
      waiting_days: expected.jobs[id].waiting_days,
      needs_decision: expected.jobs[id].needs_decision,
      review_on: expected.jobs[id].review_on,
    });
});
test.each([
  { review: { decision: ["park"], on: "2026-10-05", source: "Synthetic" } },
  {
    contacts: [
      {
        id: "synthetic",
        on: "2026-10-05",
        kind: ["human"],
        source: "Synthetic",
      },
    ],
  },
  { next_action: { text: "Draft", owner: ["owner"], source: "Synthetic" } },
])("nested enum values must be strings: %j", (t) =>
  expect(() => parseTracking(t)).toThrow(),
);
