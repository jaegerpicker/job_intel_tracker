import { createHash } from "node:crypto";
import { SecretStorage } from "../src/auth";
import { SecureWriteJournal, JournalRepository } from "../src/journal";
import { DemoRepository, fixtures } from "../src/demo";
import { BoardError, prepareWrite } from "../src/domain";
class Store implements SecretStorage {
  values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async remove(key: string) {
    this.values.delete(key);
  }
}
const hash = async (value: string) =>
  createHash("sha256").update(value).digest("hex");
const origin = "https://example.com";
const write = () =>
  prepareWrite(
    fixtures[0],
    { stage: "Offer", text: "synthetic" },
    "operation-one",
  );
test("secure chunks preserve exact Unicode write across process recreation", async () => {
  const storage = new Store(),
    journal = new SecureWriteJournal(storage, origin, hash);
  const w = write();
  w.payload.body.text = "🌿ü".repeat(1000);
  await journal.put(w);
  expect(
    [...storage.values.values()].every((v) => Buffer.byteLength(v) <= 1800),
  ).toBe(true);
  expect(await new SecureWriteJournal(storage, origin, hash).read()).toEqual(w);
  await journal.purge();
  expect(storage.values.size).toBe(0);
});
test("partial replacement keeps previous manifest recoverable", async () => {
  const storage = new Store(),
    journal = new SecureWriteJournal(storage, origin, hash);
  const original = write();
  await journal.put(original);
  const set = storage.set.bind(storage);
  storage.set = async (key, value) => {
    if (key === "pending-manifest") throw new Error("failure");
    await set(key, value);
  };
  const changed = write();
  changed.payload.body.text = "new";
  await expect(journal.put(changed)).rejects.toMatchObject({ code: "invalid" });
  expect(await new SecureWriteJournal(storage, origin, hash).read()).toEqual(
    original,
  );
});
test("wrong origin and corrupted chunks block writes", async () => {
  const storage = new Store(),
    journal = new SecureWriteJournal(storage, origin, hash);
  await journal.put(write());
  await expect(
    new SecureWriteJournal(storage, "https://other.example", hash).read(),
  ).rejects.toMatchObject({ code: "invalid" });
  await storage.set("pending-0-0", "tamper");
  await expect(journal.read()).rejects.toMatchObject({ code: "invalid" });
});
test("response loss then restart/retry creates one revision with same payload/key", async () => {
  const storage = new Store(),
    journal = new SecureWriteJournal(storage, origin, hash),
    demo = new DemoRepository();
  let interrupted = true;
  const api = {
    list: () => demo.list(),
    attachments: (id: string) => demo.attachments(id),
    save: jest.fn(async (w: ReturnType<typeof write>) => {
      const result = await demo.save(w);
      if (interrupted) {
        interrupted = false;
        throw new BoardError("network", "Interrupted");
      }
      return result;
    }),
  };
  const w = write();
  await expect(
    new JournalRepository(api, journal).save(w),
  ).rejects.toMatchObject({ code: "network" });
  const recovered = await new SecureWriteJournal(storage, origin, hash).read();
  expect(recovered).toEqual(w);
  const result = await new JournalRepository(api, journal).save(recovered!);
  expect(result.version).toBe(w.payload.version + 1);
  expect(api.save.mock.calls[0][0]).toEqual(api.save.mock.calls[1][0]);
  expect(await journal.read()).toBeNull();
});
test("conflict keeps draft and refuses a fresh key until explicit discard", async () => {
  const storage = new Store(),
    journal = new SecureWriteJournal(storage, origin, hash),
    demo = new DemoRepository();
  await demo.save(prepareWrite(fixtures[0], { stage: "Closed" }, "other"));
  const repo = new JournalRepository(demo, journal),
    w = write();
  await expect(repo.save(w)).rejects.toMatchObject({ code: "conflict" });
  expect(await journal.read()).toEqual(w);
  await expect(repo.save({ ...w, key: "new-key" })).rejects.toMatchObject({
    code: "conflict",
  });
  await journal.purge();
  const latest = (await repo.list()).find((r) => r.id === w.id)!;
  expect(
    (await repo.save(prepareWrite(latest, { stage: "Offer" }, "reviewed-new")))
      .version,
  ).toBe(latest.version + 1);
});
test("failure to persist prevents any network read/write; restricted kinds denied", async () => {
  const storage = new Store(),
    journal = new SecureWriteJournal(storage, origin, hash);
  storage.set = async () => {
    throw new Error("native secret");
  };
  const api = { list: jest.fn(), save: jest.fn(), attachments: jest.fn() };
  const repo = new JournalRepository(api, journal);
  await expect(repo.save(write())).rejects.toMatchObject({ code: "invalid" });
  expect(api.list).not.toHaveBeenCalled();
  expect(api.save).not.toHaveBeenCalled();
  const w = write();
  w.payload.kind = "filters";
  await expect(repo.save(w)).rejects.toMatchObject({ code: "forbidden" });
});
test("oversize journal is rejected without a network write", async () => {
  const storage = new Store(),
    journal = new SecureWriteJournal(storage, origin, hash),
    w = write();
  w.payload.body.text = "x".repeat(66000);
  await expect(journal.put(w)).rejects.toMatchObject({ code: "invalid" });
  expect(storage.values.size).toBe(0);
});
test("logout during suspended journal read prevents late repersistence and transport", async () => {
  const storage = new Store(),
    journal = new SecureWriteJournal(storage, origin, hash);
  let resume!: (value: null) => void;
  const read = jest.spyOn(journal, "read").mockImplementationOnce(
    () =>
      new Promise((r) => {
        resume = r;
      }),
  );
  let active = true;
  const api = { list: jest.fn(), save: jest.fn(), attachments: jest.fn() };
  const repo = new JournalRepository(api, journal, () => {
    if (!active) throw new BoardError("unauthorized", "Signed out");
  });
  const operation = repo.save(write());
  active = false;
  await journal.purge();
  resume(null);
  await expect(operation).rejects.toMatchObject({ code: "unauthorized" });
  expect(api.list).not.toHaveBeenCalled();
  expect(api.save).not.toHaveBeenCalled();
  expect(storage.values.size).toBe(0);
  read.mockRestore();
});
