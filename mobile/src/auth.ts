import { BoardError } from "./domain";
import type { OwnerSessionSource } from "./runtime";
export interface SecretStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface NativeBrowser {
  open(url: string, redirect: string): Promise<{ type: string; url?: string }>;
}
export interface PkceCrypto {
  random(): Promise<string>; // at least 32 cryptographically random bytes, base64url
  challenge(verifier: string): Promise<string>;
}
export type AuthSnapshot = {
  status: "restoring" | "signedOut" | "signingIn" | "signedIn";
  message: string;
  revision: number;
};
interface Session {
  token: string;
  expiresAt: number;
  origin: string;
}
interface Login {
  verifier: string;
  state: string;
  expiresAt: number;
  redirect: string;
  origin: string;
}
const randomPattern = /^[A-Za-z0-9_-]{43,128}$/;
export function httpsOrigin(value: string): string {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    throw new BoardError("invalid", "Configure a canonical HTTPS API origin.");
  return u.origin;
}
export function claimedRedirect(value: string): string {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/auth/mobile/callback"
  )
    throw new BoardError(
      "invalid",
      "Configure a claimed HTTPS /auth/mobile/callback link.",
    );
  return u.href;
}
/** No provider tokens, browser cookies, refresh grants or public-build credentials. */
export class MobileAuth {
  private session?: Session;
  private snapshot: AuthSnapshot = {
    status: "restoring",
    message: "",
    revision: 0,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private busy?: Promise<void>;
  private completion?: Promise<void>;
  private storageTail: Promise<unknown> = Promise.resolve();
  private cleanupBlocked = false;
  readonly origin: string;
  readonly redirect: string;
  constructor(
    private options: {
      origin: string;
      redirect: string;
      storage: SecretStorage;
      browser: NativeBrowser;
      crypto: PkceCrypto;
      transport?: typeof fetch;
      now?: () => number;
    },
  ) {
    this.origin = httpsOrigin(options.origin);
    this.redirect = claimedRedirect(options.redirect);
    if (new URL(this.redirect).origin !== this.origin)
      throw new BoardError(
        "invalid",
        "The callback must use the canonical API origin.",
      );
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private publish(status: AuthSnapshot["status"], message = "") {
    this.snapshot = { status, message, revision: this.snapshot.revision + 1 };
    this.listeners.forEach((listener) => listener());
  }
  private storage<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.storageTail.then(operation);
    this.storageTail = run.catch(() => undefined);
    return run;
  }
  private async request(
    path: string,
    payload?: unknown,
    token?: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await (this.options.transport ?? fetch)(
        new URL(path, this.origin),
        {
          method: "POST",
          credentials: "omit",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload ?? {}),
        },
      );
      if (!r.ok)
        throw new BoardError(
          r.status === 401 ? "unauthorized" : "invalid",
          "Sign-in could not be completed. Start a new sign-in.",
        );
      return await r.json();
    } catch (e) {
      if (e instanceof BoardError) throw e;
      throw new BoardError(
        "network",
        "Connection interrupted. Return to sign-in or start again.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async restore(clearPending: () => Promise<void> = async () => {}) {
    const generation = ++this.generation;
    try {
      const tombstone = await this.storage(() =>
        this.options.storage.get("owner-logout"),
      );
      if (tombstone) {
        await this.storage(async () => {
          await this.options.storage.remove("owner-session");
          await this.options.storage.remove("owner-login");
          await clearPending();
          await this.options.storage.remove("owner-logout");
        });
        if (generation === this.generation)
          this.publish(
            "signedOut",
            "Interrupted sign out completed. Local work cleared.",
          );
        return;
      }
      const raw = await this.storage(() =>
        this.options.storage.get("owner-session"),
      );
      if (generation !== this.generation) return;
      if (raw) {
        const s = JSON.parse(raw) as Session;
        if (
          s.origin === this.origin &&
          typeof s.token === "string" &&
          /^mobile_[A-Za-z0-9_-]{43,128}$/.test(s.token) &&
          this.validExpiry(s.expiresAt)
        ) {
          this.session = s;
          this.publish("signedIn");
          return;
        }
        await this.storage(() => this.options.storage.remove("owner-session"));
      }
      if (generation === this.generation) this.publish("signedOut");
    } catch {
      this.cleanupBlocked = true;
      if (generation === this.generation)
        this.publish(
          "signedOut",
          "Secure storage is unavailable. Live access remains locked.",
        );
    }
  }
  private validExpiry(expiresAt: number) {
    return (
      Number.isFinite(expiresAt) &&
      expiresAt > this.now() &&
      expiresAt - this.now() <= 15 * 60 * 1000
    );
  }
  signIn(provider: "apple" | "google" = "apple"): Promise<void> {
    if (this.busy) return this.busy;
    this.busy = this.begin(provider).finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }
  private async begin(provider: "apple" | "google") {
    if (this.snapshot.status === "signedIn" || this.cleanupBlocked) return;
    const generation = ++this.generation;
    this.publish("signingIn");
    try {
      const verifier = await this.options.crypto.random();
      const state = await this.options.crypto.random();
      const challenge = await this.options.crypto.challenge(verifier);
      if (
        !randomPattern.test(verifier) ||
        !randomPattern.test(state) ||
        !/^[A-Za-z0-9_-]{43}$/.test(challenge)
      )
        throw new Error("Invalid randomness");
      const result = (await this.request("/auth/mobile/start", {
        redirect_uri: this.redirect,
        code_challenge: challenge,
        code_challenge_method: "S256",
        client_state: state,
        provider,
      })) as { authorization_url?: unknown; expires_at?: unknown };
      const url = new URL(String(result.authorization_url));
      const expiresAt = Number(result.expires_at) * 1000;
      if (
        url.origin !== this.origin ||
        url.pathname !== "/auth/mobile/authorize" ||
        url.username ||
        url.password ||
        url.hash ||
        url.searchParams.getAll("ticket").length !== 1 ||
        !randomPattern.test(url.searchParams.get("ticket") ?? "") ||
        [...url.searchParams.keys()].some((key) => key !== "ticket") ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= this.now() ||
        expiresAt - this.now() > 5 * 60 * 1000
      )
        throw new Error("Invalid start");
      if (generation !== this.generation) return;
      const login: Login = {
        verifier,
        state,
        expiresAt,
        redirect: this.redirect,
        origin: this.origin,
      };
      await this.storage(async () => {
        if (generation === this.generation)
          await this.options.storage.set("owner-login", JSON.stringify(login));
      });
      if (generation !== this.generation) return;
      const browser = await this.options.browser.open(url.href, this.redirect);
      if (generation !== this.generation) return;
      if (browser.type === "success" && browser.url)
        await this.complete(browser.url);
      else {
        await this.storage(() => this.options.storage.remove("owner-login"));
        this.publish("signedOut", "Sign-in cancelled.");
      }
    } catch (e) {
      if (generation === this.generation)
        this.publish(
          "signedOut",
          e instanceof BoardError
            ? e.message
            : "Sign-in could not be completed securely. Start again.",
        );
    }
  }
  complete(url: string): Promise<void> {
    if (this.snapshot.status === "signedIn" || this.cleanupBlocked)
      return Promise.resolve();
    if (this.completion) return this.completion;
    this.completion = this.exchange(url).finally(() => {
      this.completion = undefined;
    });
    return this.completion;
  }
  private async exchange(value: string) {
    const generation = this.generation;
    let issued: string | undefined;
    try {
      const url = new URL(value);
      if (
        url.origin + url.pathname !== this.redirect ||
        url.hash ||
        url.username ||
        url.password ||
        url.searchParams.getAll("code").length !== 1 ||
        url.searchParams.getAll("state").length !== 1 ||
        [...url.searchParams.keys()].some((k) => !["code", "state"].includes(k))
      )
        throw new Error("Invalid callback");
      const raw = await this.storage(() =>
        this.options.storage.get("owner-login"),
      );
      if (!raw) throw new Error("No pending login");
      const login = JSON.parse(raw) as Login;
      const code = url.searchParams.get("code") ?? "";
      if (
        login.origin !== this.origin ||
        login.redirect !== this.redirect ||
        !Number.isFinite(login.expiresAt) ||
        !randomPattern.test(login.state) ||
        login.expiresAt <= this.now() ||
        login.expiresAt - this.now() > 300000 ||
        !randomPattern.test(login.verifier) ||
        login.state !== url.searchParams.get("state") ||
        !randomPattern.test(code)
      )
        throw new Error("Invalid transaction");
      const result = (await this.request("/auth/mobile/exchange", {
        code,
        code_verifier: login.verifier,
        redirect_uri: this.redirect,
      })) as { access_token?: unknown; expires_at?: unknown; actor?: unknown };
      const session = {
        token: String(result.access_token),
        expiresAt: Number(result.expires_at) * 1000,
        origin: this.origin,
      };
      if (
        result.actor !== "owner" ||
        !/^mobile_[A-Za-z0-9_-]{43,128}$/.test(session.token) ||
        !this.validExpiry(session.expiresAt)
      )
        throw new Error("Invalid session");
      issued = session.token;
      if (generation !== this.generation) {
        await this.request("/auth/mobile/logout", {}, session.token).catch(
          () => undefined,
        );
        return;
      }
      await this.storage(async () => {
        if (generation !== this.generation) {
          await this.request("/auth/mobile/logout", {}, session.token).catch(
            () => undefined,
          );
          return;
        }
        await this.options.storage.set(
          "owner-session",
          JSON.stringify(session),
        );
        await this.options.storage.remove("owner-login");
      });
      if (generation !== this.generation) {
        await this.request("/auth/mobile/logout", {}, session.token).catch(
          () => undefined,
        );
        return;
      }
      this.session = session;
      this.publish("signedIn");
    } catch (e) {
      if (issued) {
        await this.request("/auth/mobile/logout", {}, issued).catch(
          () => undefined,
        );
        await this.storage(() =>
          this.options.storage.remove("owner-session"),
        ).catch(async () => {
          this.cleanupBlocked = true;
          await this.storage(() =>
            this.options.storage.set("owner-logout", "1"),
          ).catch(() => undefined);
        });
      }
      if (generation === this.generation)
        this.publish(
          "signedOut",
          e instanceof BoardError
            ? e.message
            : "Sign-in return could not be verified. Start again.",
        );
    }
  }
  source(): OwnerSessionSource | undefined {
    const current = this.session;
    if (!current) return undefined;
    return {
      origin: this.origin,
      expiresAt: current.expiresAt,
      isCurrent: () =>
        this.session === current && this.validExpiry(current.expiresAt),
      headers: async () => {
        if (this.session !== current || !this.validExpiry(current.expiresAt)) {
          if (this.session === current) this.invalidate();
          throw new BoardError(
            "unauthorized",
            "Owner session expired. Sign in to review pending work.",
          );
        }
        return { Authorization: `Bearer ${current.token}` };
      },
      invalidate: () => {
        if (this.session === current) this.invalidate();
      },
    };
  }
  invalidate() {
    this.generation++;
    this.session = undefined;
    this.publish("signedOut", "Session ended. Sign in to review pending work.");
    void this.storage(() => this.options.storage.remove("owner-session")).catch(
      () => {
        this.cleanupBlocked = true;
        this.publish(
          "signedOut",
          "Secure storage cleanup failed. Sign out again before continuing.",
        );
      },
    );
  }
  async logout(clearPending: () => Promise<void>) {
    ++this.generation;
    const token = this.session?.token;
    this.cleanupBlocked = true;
    this.session = undefined;
    this.publish("signedOut", "Signing out and clearing local work…");
    let cleanupFailed = false;
    try {
      await this.storage(async () => {
        await this.options.storage.set("owner-logout", "1");
        await this.options.storage.remove("owner-session");
        await this.options.storage.remove("owner-login");
        await clearPending();
        await this.options.storage.remove("owner-logout");
      });
    } catch {
      cleanupFailed = true;
      this.cleanupBlocked = true;
    }
    // Revocation is independent of local persistence success.
    let remoteFailed = false;
    if (token)
      await this.request("/auth/mobile/logout", {}, token).catch(() => {
        remoteFailed = true;
      });
    this.cleanupBlocked = cleanupFailed;
    this.publish(
      "signedOut",
      cleanupFailed
        ? "Secure storage cleanup failed. Retry sign out before continuing."
        : remoteFailed
          ? "Local session and work cleared. Server revocation could not be confirmed; access expires within 15 minutes."
          : "Signed out. Local session and pending work cleared.",
    );
  }
}
