import { ApiRepository } from "./api";
import { DemoRepository } from "./demo";
import { BoardError, PendingWrite, Repository } from "./domain";
export type AppMode = "demo" | "live";
/** Supplied only by a future approved owner-session exchange. Never read credentials from build variables. */
export interface OwnerSessionSource {
  readonly origin: string;
  readonly expiresAt: number; // Unix milliseconds, at most eight hours from now
  headers(): Promise<{ Authorization: string }>;
  invalidate(): void;
}
export interface AppRuntime {
  mode: AppMode;
  repository: Repository;
  canWrite: boolean;
  lockedReason?: string;
}
const locked = (message: string): Repository => ({
  list: async () => {
    throw new BoardError("unauthorized", message);
  },
  attachments: async () => {
    throw new BoardError("unauthorized", message);
  },
  save: async () => {
    throw new BoardError("forbidden", message);
  },
});
class OwnerReadRepository implements Repository {
  constructor(
    private api: ApiRepository,
    private session: OwnerSessionSource,
  ) {}
  private async read<T>(operation: () => Promise<T>): Promise<T> {
    try {
      const identity = await this.api.identity();
      if (identity.actor !== "owner")
        throw new BoardError(
          "forbidden",
          "An approved owner session is required. Agent credentials cannot enable mobile owner access.",
        );
      return await operation();
    } catch (error) {
      if (
        error instanceof BoardError &&
        ["unauthorized", "forbidden"].includes(error.code)
      )
        this.session.invalidate();
      throw error;
    }
  }
  async list() {
    return this.read(() => this.api.list());
  }
  async attachments(job: string) {
    return this.read(() => this.api.attachments(job));
  }
  async save(_write: PendingWrite): Promise<never> {
    throw new BoardError(
      "forbidden",
      "Live writes are disabled until an encrypted persistent operation journal and conflict review are implemented.",
    );
  }
}
/** No configuration defaults to synthetic demo. Explicit live and unknown modes fail closed; live never falls back to demo. */
export function createRuntime(options: {
  mode?: string;
  origin?: string;
  session?: OwnerSessionSource;
  transport?: typeof fetch;
  now?: () => number;
}): AppRuntime {
  if (options.mode === undefined || options.mode === "demo")
    return { mode: "demo", repository: new DemoRepository(), canWrite: true };
  const lock = (reason: string): AppRuntime => ({
    mode: "live",
    repository: locked(reason),
    canWrite: false,
    lockedReason: reason,
  });
  if (options.mode !== "live")
    return lock(
      "Unknown app mode. Set EXPO_PUBLIC_TRACKER_MODE to demo or live.",
    );
  if (!options.origin)
    return lock(
      "Live mode requires an explicitly configured canonical HTTPS API origin. No production URL is bundled.",
    );
  if (!options.session)
    return lock(
      "Live mode is locked. An approved native owner-session exchange is not implemented. No credential entry or browser-session copying is available.",
    );
  const session = options.session;
  const now = options.now ?? Date.now;
  let revoked = false;
  const source: OwnerSessionSource = {
    ...session,
    headers: () => session.headers(),
    invalidate: () => {
      revoked = true;
      session.invalidate();
    },
  };
  try {
    const origin = new URL(options.origin).origin;
    if (
      session.origin !== origin ||
      !Number.isFinite(session.expiresAt) ||
      session.expiresAt <= now() ||
      session.expiresAt - now() > 8 * 60 * 60 * 1000
    )
      return lock("Owner session origin or expiry is invalid.");
    const api = new ApiRepository(
      options.origin,
      async () => {
        if (revoked || now() >= session.expiresAt) {
          source.invalidate();
          throw new BoardError("unauthorized", "Owner session expired.");
        }
        const headers = await session.headers();
        if (
          typeof headers.Authorization !== "string" ||
          !/^Bearer [^\s]+$/.test(headers.Authorization)
        )
          throw new BoardError(
            "unauthorized",
            "An approved ephemeral owner session is required.",
          );
        return { Authorization: headers.Authorization };
      },
      options.transport,
    );
    return {
      mode: "live",
      repository: new OwnerReadRepository(api, source),
      canWrite: false,
    };
  } catch {
    return lock(
      "Use a canonical HTTPS origin without credentials, query strings, or a path.",
    );
  }
}
