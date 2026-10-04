import { createRuntime, OwnerSessionSource } from "../src/runtime";
import { fixtures } from "../src/demo";
import { prepareWrite } from "../src/domain";
const origin = "https://example.com";
const now = 1000;
const session = (): OwnerSessionSource => ({
  origin,
  expiresAt: now + 60000,
  headers: jest.fn(async () => ({
    Authorization: "Bearer synthetic-test-only",
  })),
  invalidate: jest.fn(),
});
const response = (body: unknown, status = 200) =>
  ({ ok: status === 200, status, json: async () => body }) as Response;
test.each(["live", "unexpected"])(
  "missing session/mode locks without any network access: %s",
  async (mode) => {
    const transport = jest.fn();
    const runtime = createRuntime({ mode, origin, transport });
    expect(runtime.canWrite).toBe(false);
    expect(runtime.lockedReason).toBeTruthy();
    await expect(runtime.repository.list()).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(transport).not.toHaveBeenCalled();
  },
);
test("demo remains explicit and self contained", async () => {
  const runtime = createRuntime({ mode: "demo" });
  expect(runtime.mode).toBe("demo");
  expect(runtime.canWrite).toBe(true);
  expect(await runtime.repository.list()).toEqual(fixtures);
});
test("live reads require verified owner and writes never reach transport", async () => {
  const source = session();
  const transport = jest
    .fn()
    .mockResolvedValueOnce(response({ actor: "owner" }))
    .mockResolvedValueOnce(response(fixtures));
  const runtime = createRuntime({
    mode: "live",
    origin,
    session: source,
    transport,
    now: () => now,
  });
  expect(runtime.lockedReason).toBeUndefined();
  expect(await runtime.repository.list()).toEqual(fixtures);
  expect(String(transport.mock.calls[0][0])).toBe(origin + "/api/me");
  expect(String(transport.mock.calls[1][0])).toBe(origin + "/api/records");
  await expect(
    runtime.repository.save(
      prepareWrite(fixtures[0], { stage: "Offer" }, "key"),
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(transport).toHaveBeenCalledTimes(2);
});
test("agent identity is refused before reading records and invalidates session", async () => {
  const source = session();
  const transport = jest
    .fn()
    .mockResolvedValue(response({ actor: "agent:reader" }));
  const runtime = createRuntime({
    mode: "live",
    origin,
    session: source,
    transport,
    now: () => now,
  });
  await expect(runtime.repository.list()).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(source.invalidate).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledTimes(1);
  await expect(runtime.repository.list()).rejects.toMatchObject({
    code: "unauthorized",
  });
  expect(transport).toHaveBeenCalledTimes(1);
});
test("origin mismatch and long lived/expired sources remain locked", () => {
  for (const s of [
    { ...session(), origin: "https://other.example.com" },
    { ...session(), expiresAt: now - 1 },
    { ...session(), expiresAt: now + 9 * 60 * 60 * 1000 },
  ])
    expect(
      createRuntime({ mode: "live", origin, session: s, now: () => now })
        .lockedReason,
    ).toBeTruthy();
});
test("expiry and server revocation stop subsequent transport calls", async () => {
  let clock = now;
  const source = session();
  const transport = jest
    .fn()
    .mockResolvedValueOnce(response({ actor: "owner" }))
    .mockResolvedValueOnce(response({}, 401));
  const runtime = createRuntime({
    mode: "live",
    origin,
    session: source,
    transport,
    now: () => clock,
  });
  await expect(runtime.repository.list()).rejects.toMatchObject({
    code: "unauthorized",
  });
  expect(source.invalidate).toHaveBeenCalled();
  clock = source.expiresAt;
  await expect(
    runtime.repository.attachments("demo-cedar"),
  ).rejects.toMatchObject({ code: "unauthorized" });
  expect(transport).toHaveBeenCalledTimes(2);
});

test("no mode configuration defaults only to synthetic demo without transport", async () => {
  const transport = jest.fn();
  const runtime = createRuntime({ transport });
  expect(runtime.mode).toBe("demo");
  await runtime.repository.list();
  expect(transport).not.toHaveBeenCalled();
});
