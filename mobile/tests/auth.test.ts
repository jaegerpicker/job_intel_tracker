import { createHash } from "node:crypto";
import { MobileAuth, SecretStorage } from "../src/auth";
const origin = "https://example.com";
const redirect = origin + "/auth/mobile/callback";
const verifier = "v".repeat(43),
  state = "s".repeat(43),
  code = "c".repeat(43),
  token = "mobile_" + "t".repeat(43);
const response = (body: unknown, status = 200) =>
  ({ ok: status === 200, status, json: async () => body }) as Response;
export class Secrets implements SecretStorage {
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
function harness() {
  let now = 1000000;
  const store = new Secrets();
  const transport = jest.fn(
    async (url: URL | RequestInfo, init?: RequestInit) => {
      if (String(url).endsWith("/start"))
        return response({
          authorization_url:
            origin + "/auth/mobile/authorize?ticket=" + "a".repeat(43),
          expires_at: (now + 300000) / 1000,
        });
      if (String(url).endsWith("/exchange"))
        return response({
          access_token: token,
          expires_at: (now + 900000) / 1000,
          actor: "owner",
        });
      return response({ ok: true });
    },
  );
  const browser = {
    open: jest.fn(async () => ({
      type: "success",
      url: redirect + `?code=${code}&state=${state}`,
    })),
  };
  const random = jest
    .fn()
    .mockResolvedValueOnce(verifier)
    .mockResolvedValue(state);
  const options = {
    origin,
    redirect,
    storage: store,
    browser,
    transport: transport as typeof fetch,
    now: () => now,
    crypto: {
      random,
      challenge: async (v: string) =>
        createHash("sha256").update(v).digest("base64url"),
    },
  };
  return {
    auth: new MobileAuth(options),
    store,
    browser,
    transport,
    options,
    clock: (value: number) => {
      now = value;
    },
  };
}
test("PKCE browser exchange persists short owner session without exposing secrets in snapshot", async () => {
  const h = harness();
  await h.auth.restore();
  await h.auth.signIn();
  expect(h.auth.getSnapshot().status).toBe("signedIn");
  const start = JSON.parse(String(h.transport.mock.calls[0][1]?.body));
  expect(start.code_challenge).toBe(
    createHash("sha256").update(verifier).digest("base64url"),
  );
  expect(start).not.toHaveProperty("code_verifier");
  expect(h.browser.open.mock.calls[0]).not.toContain(token);
  expect(h.store.values.has("owner-login")).toBe(false);
  expect(JSON.stringify(h.auth.getSnapshot())).not.toMatch(
    new RegExp([token, verifier, code].join("|")),
  );
  expect(await h.auth.source()?.headers()).toEqual({
    Authorization: "Bearer " + token,
  });
  const restored = new MobileAuth(h.options);
  await restored.restore();
  expect(restored.getSnapshot().status).toBe("signedIn");
  expect(
    h.transport.mock.calls.every((call) => call[1]?.credentials === "omit"),
  ).toBe(true);
});
test.each([
  "https://evil.example/auth/mobile/callback?code=" + code + "&state=" + state,
  redirect + "?code=" + code + "&state=wrong",
  redirect + "?code=" + code + "&code=" + code + "&state=" + state,
  redirect + "?code=" + code + "&state=" + state + "#token=secret",
])("invalid callback never exchanges: %s", async (url) => {
  const h = harness();
  h.browser.open.mockResolvedValue({ type: "success", url });
  await h.auth.signIn();
  expect(h.auth.getSnapshot().status).toBe("signedOut");
  expect(h.transport).toHaveBeenCalledTimes(1);
  expect(h.auth.getSnapshot().message).not.toContain(url);
});
test("repeated login is single flight; cancel clears verifier", async () => {
  const h = harness();
  h.browser.open.mockResolvedValue({ type: "cancel", url: "" });
  const a = h.auth.signIn(),
    b = h.auth.signIn();
  expect(a).toBe(b);
  await a;
  expect(h.browser.open).toHaveBeenCalledTimes(1);
  expect(h.store.values.has("owner-login")).toBe(false);
});
test("interrupted exchange survives restart; repeated callback exchanges only once", async () => {
  const h = harness();
  h.transport
    .mockImplementationOnce(async () =>
      response({
        authorization_url:
          origin + "/auth/mobile/authorize?ticket=" + "a".repeat(43),
        expires_at: 1300,
      }),
    )
    .mockRejectedValueOnce(new Error("private provider response " + token));
  await h.auth.signIn();
  expect(h.store.values.has("owner-login")).toBe(true);
  expect(h.auth.getSnapshot().message).not.toContain(token);
  const restored = new MobileAuth(h.options);
  await restored.restore();
  const url = redirect + `?code=${code}&state=${state}`;
  await Promise.all([restored.complete(url), restored.complete(url)]);
  expect(restored.getSnapshot().status).toBe("signedIn");
  expect(
    h.transport.mock.calls.filter((call) =>
      String(call[0]).endsWith("/exchange"),
    ),
  ).toHaveLength(2);
  await restored.complete(url); // consumed locally; cannot redeem again
  expect(h.transport).toHaveBeenCalledTimes(3);
});
test("expired session and wrong persisted origin fail closed", async () => {
  const h = harness();
  await h.auth.signIn();
  h.clock(1900001);
  await expect(h.auth.source()?.headers()).rejects.toMatchObject({
    code: "unauthorized",
  });
  expect(h.auth.getSnapshot().status).toBe("signedOut");
  await h.store.set(
    "owner-session",
    JSON.stringify({
      token,
      origin: "https://evil.example",
      expiresAt: 1901000,
    }),
  );
  const restored = new MobileAuth(h.options);
  await restored.restore();
  expect(restored.source()).toBeUndefined();
});
test("logout racing exchange revokes returned token and cannot restore access", async () => {
  const h = harness();
  let resolve!: (value: Response) => void;
  h.transport
    .mockImplementationOnce(async () =>
      response({
        authorization_url:
          origin + "/auth/mobile/authorize?ticket=" + "a".repeat(43),
        expires_at: 1300,
      }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  const login = h.auth.signIn();
  while (!resolve) await new Promise((r) => setTimeout(r, 0));
  const clear = jest.fn(async () => {});
  await h.auth.logout(clear);
  resolve(response({ access_token: token, expires_at: 1900, actor: "owner" }));
  await login;
  expect(h.auth.source()).toBeUndefined();
  expect(h.store.values.has("owner-session")).toBe(false);
  expect(h.transport.mock.calls.at(-1)?.[1]?.headers).toMatchObject({
    Authorization: "Bearer " + token,
  });
  expect(clear).toHaveBeenCalledTimes(1);
});
test("untrusted start URL and server errors do not leak secrets or open browser", async () => {
  const h = harness();
  h.transport.mockResolvedValue(
    response({
      authorization_url: "https://evil.example/?token=" + token,
      expires_at: 1300,
    }),
  );
  await h.auth.signIn();
  expect(h.browser.open).not.toHaveBeenCalled();
  expect(h.auth.getSnapshot().message).not.toContain(token);
});
test("secure persistence failure keeps live access locked", async () => {
  const h = harness();
  h.store.set = jest.fn(async () => {
    throw new Error("native secret " + token);
  });
  await h.auth.signIn();
  expect(h.browser.open).not.toHaveBeenCalled();
  expect(h.auth.source()).toBeUndefined();
  expect(h.auth.getSnapshot().message).not.toContain(token);
});
test("offline logout clears credentials and reports bounded server authority honestly", async () => {
  const h = harness();
  await h.auth.signIn();
  h.transport.mockRejectedValue(new Error("secret " + token));
  await h.auth.logout(async () => {});
  expect(h.auth.source()).toBeUndefined();
  expect(h.store.values.size).toBe(0);
  expect(h.auth.getSnapshot().message).toContain("15 minutes");
  expect(h.auth.getSnapshot().message).not.toContain(token);
});
test("obsolete session sources cannot invalidate a newer owner login", async () => {
  const h = harness();
  await h.auth.signIn();
  const old = h.auth.source()!;
  await h.auth.logout(async () => {});
  await h.auth.signIn();
  expect(h.auth.getSnapshot().status).toBe("signedIn");
  old.invalidate();
  await expect(old.headers()).rejects.toMatchObject({ code: "unauthorized" });
  expect(h.auth.getSnapshot().status).toBe("signedIn");
  expect(await h.auth.source()?.headers()).toEqual({
    Authorization: "Bearer " + token,
  });
});
test("logout local tombstone survives interrupted cleanup and blocks restored credentials", async () => {
  const h = harness();
  await h.auth.signIn();
  const clear = jest.fn(async () => {
    throw new Error("storage unavailable");
  });
  await h.auth.logout(clear);
  expect(h.store.values.get("owner-logout")).toBe("1");
  const calls = h.transport.mock.calls.length;
  await h.auth.signIn();
  expect(h.transport).toHaveBeenCalledTimes(calls);
  const restored = new MobileAuth(h.options),
    purge = jest.fn(async () => {});
  await restored.restore(purge);
  expect(restored.source()).toBeUndefined();
  expect(purge).toHaveBeenCalledTimes(1);
  expect(h.store.values.has("owner-logout")).toBe(false);
});
test("local cleanup failure still revokes the remote session and blocks reuse", async () => {
  const h = harness();
  await h.auth.signIn();
  await h.auth.logout(async () => {
    throw new Error("private storage failure " + token);
  });
  expect(String(h.transport.mock.calls.at(-1)?.[0])).toBe(
    origin + "/auth/mobile/logout",
  );
  expect(h.auth.getSnapshot().message).toContain("cleanup failed");
  expect(h.auth.getSnapshot().message).not.toContain(token);
  const calls = h.transport.mock.calls.length;
  await h.auth.signIn();
  expect(h.transport).toHaveBeenCalledTimes(calls);
});
test("session issued before storage cleanup failure is revoked and never restored", async () => {
  const h = harness(),
    remove = h.store.remove.bind(h.store);
  h.store.remove = async (key) => {
    if (key === "owner-login") throw new Error("keychain private " + token);
    await remove(key);
  };
  await h.auth.signIn();
  expect(h.auth.source()).toBeUndefined();
  expect(h.store.values.has("owner-session")).toBe(false);
  expect(String(h.transport.mock.calls.at(-1)?.[0])).toBe(
    origin + "/auth/mobile/logout",
  );
  expect(h.auth.getSnapshot().message).not.toContain(token);
});
