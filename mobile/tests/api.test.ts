import { ApiRepository } from "../src/api";
import { fixtures } from "../src/demo";
import { prepareWrite } from "../src/domain";
function response(status: number, body: unknown) {
  return { ok: status === 200, status, json: async () => body } as Response;
}
test("requires a credential-free HTTPS origin", () => {
  for (const origin of [
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com?token=secret",
    "https://example.com/api",
  ])
    expect(() => new ApiRepository(origin, async () => ({}))).toThrow();
});
test("transport retries preserve exact operation and never use ambient cookies", async () => {
  const fetcher = jest
    .fn()
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValue(response(200, { ...fixtures[0], version: 2 }));
  const repo = new ApiRepository(
    "https://example.com",
    async () => ({ Authorization: "Bearer test-only" }),
    fetcher,
  );
  const write = prepareWrite(fixtures[0], { stage: "Offer" }, "stable-key");
  await expect(repo.save(write)).rejects.toMatchObject({ code: "network" });
  await repo.save(write);
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  expect(fetcher.mock.calls[1][1].headers["Idempotency-Key"]).toBe(
    "stable-key",
  );
  expect(fetcher.mock.calls[1][1].credentials).toBe("omit");
});
test.each([
  [401, "unauthorized"],
  [403, "forbidden"],
  [409, "conflict"],
])("maps %s without exposing private server text", async (status, code) => {
  const repo = new ApiRepository(
    "https://example.com",
    async () => ({}),
    jest
      .fn()
      .mockResolvedValue(
        response(status as number, { detail: "private-secret" }),
      ),
  );
  await expect(repo.list()).rejects.toMatchObject({ code });
  await expect(repo.list()).rejects.not.toThrow("private-secret");
});
test("validates lists and encodes resource IDs", async () => {
  const fetcher = jest.fn().mockResolvedValue(response(200, [{ bad: true }]));
  const repo = new ApiRepository(
    "https://example.com",
    async () => ({}),
    fetcher,
  );
  await expect(repo.list()).rejects.toMatchObject({ code: "invalid" });
  fetcher.mockResolvedValue(response(200, []));
  await repo.attachments("a/b?x");
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toBe(
    "https://example.com/api/jobs/a%2Fb%3Fx/attachments",
  );
});
