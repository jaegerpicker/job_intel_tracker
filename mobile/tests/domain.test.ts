import { fixtures, DemoRepository } from "../src/demo";
import {
  active,
  filterJobs,
  prepareWrite,
  parseRecord,
  safeSource,
  validateFile,
} from "../src/domain";
test("filters by actual title and stage and counts active primary roles", () => {
  expect(filterJobs(fixtures, "native", "Prospect")).toHaveLength(1);
  expect(fixtures.filter(active)).toHaveLength(3);
  expect(
    active({
      ...fixtures[0],
      body: { ...fixtures[0].body, primary_id: "other" },
    }),
  ).toBe(false);
});
test("writes preserve unknown and owner fields and use current version", () => {
  const record = {
    ...fixtures[0],
    body: { ...fixtures[0].body, owner_assessment: "Keep", future_field: 3 },
  };
  expect(prepareWrite(record, { stage: "Offer" }, "operation").payload).toEqual(
    {
      kind: "job",
      job: null,
      version: 1,
      body: { ...record.body, stage: "Offer" },
    },
  );
});
test("untrusted response and unsafe URL/file inputs are rejected", () => {
  expect(() => parseRecord({ ...fixtures[0], version: "1" })).toThrow();
  expect(() =>
    parseRecord({ ...fixtures[0], body: { stage: "invented" } }),
  ).toThrow();
  expect(() =>
    parseRecord({
      ...fixtures[0],
      body: { ...fixtures[0].body, timeline: [null] },
    }),
  ).toThrow();
  expect(safeSource("javascript:alert(1)")).toBeNull();
  expect(safeSource("https://password:secret@example.com")).toBeNull();
  expect(safeSource("https://example.com")).toBe("https://example.com/");
  expect(validateFile("../resume.pdf", 1)).toBe(false);
  expect(validateFile("resume.pdf", 5 * 1024 * 1024 + 1)).toBe(false);
  expect(validateFile("resume.docx", 100)).toBe(true);
});
test("identical retry writes once; stale write and changed key payload conflict", async () => {
  const repo = new DemoRepository();
  const write = prepareWrite(fixtures[0], { stage: "Offer" }, "same");
  const saved = await repo.save(write);
  expect(saved.version).toBe(2);
  expect(await repo.save(write)).toEqual(saved);
  await expect(
    repo.save({
      ...write,
      payload: {
        ...write.payload,
        body: { ...write.payload.body, stage: "Applied" },
      },
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(repo.save({ ...write, key: "new" })).rejects.toMatchObject({
    code: "conflict",
  });
  expect((await repo.list()).find((r) => r.id === saved.id)?.version).toBe(2);
});
