import { BoardError, BoardRecord, PendingWrite, Repository } from "./domain";
import { SecretStorage } from "./auth";
export interface WriteJournal {
  read(): Promise<PendingWrite | null>;
  put(write: PendingWrite): Promise<void>;
  clear(): Promise<void>;
}
const chunks = 37;
/** Two encrypted banks: publish a manifest only after every chunk has persisted. */
export class SecureWriteJournal implements WriteJournal {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private store: SecretStorage,
    private origin: string,
    private hash: (value: string) => Promise<string>,
  ) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async manifest(): Promise<{
    bank: number;
    count: number;
    digest: string;
  } | null> {
    const raw = await this.store.get("pending-manifest");
    if (!raw) return null;
    const m = JSON.parse(raw);
    if (
      ![0, 1].includes(m.bank) ||
      !Number.isInteger(m.count) ||
      m.count < 1 ||
      m.count > chunks ||
      typeof m.digest !== "string"
    )
      throw new Error("Invalid journal");
    return m;
  }
  read(): Promise<PendingWrite | null> {
    return this.serial(async () => {
      try {
        const m = await this.manifest();
        if (!m) return null;
        let value = "";
        for (let i = 0; i < m.count; i++) {
          const chunk = await this.store.get(`pending-${m.bank}-${i}`);
          if (chunk === null) throw new Error("Incomplete journal");
          value += chunk;
        }
        if ((await this.hash(value)) !== m.digest)
          throw new Error("Invalid journal");
        const p = JSON.parse(value);
        if (p.origin !== this.origin || !validWrite(p.write))
          throw new Error("Wrong journal");
        return p.write;
      } catch {
        throw new BoardError(
          "invalid",
          "Pending work could not be verified. Clear local work before saving.",
        );
      }
    });
  }
  put(write: PendingWrite): Promise<void> {
    return this.serial(async () => {
      if (!validWrite(write))
        throw new BoardError("invalid", "Invalid pending operation.");
      // ASCII escapes keep each SecureStore value below historical iOS byte limits.
      const value = JSON.stringify({ origin: this.origin, write }).replace(
        /[^\x20-\x7e]/g,
        (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
      );
      if (value.length > 65536)
        throw new BoardError(
          "invalid",
          "This edit exceeds the 64 KiB secure pending-work limit. Shorten it before saving.",
        );
      try {
        const previous = await this.manifest();
        const bank = previous?.bank === 0 ? 1 : 0;
        const count = Math.ceil(value.length / 1800);
        for (let i = 0; i < count; i++)
          await this.store.set(
            `pending-${bank}-${i}`,
            value.slice(i * 1800, (i + 1) * 1800),
          );
        await this.store.set(
          "pending-manifest",
          JSON.stringify({ bank, count, digest: await this.hash(value) }),
        );
        if (previous)
          for (let i = 0; i < previous.count; i++)
            await this.store.remove(`pending-${previous.bank}-${i}`);
      } catch {
        throw new BoardError(
          "invalid",
          "Secure pending work could not be saved. No new write was sent.",
        );
      }
    });
  }
  clear(): Promise<void> {
    return this.serial(async () => {
      await this.store.remove("pending-manifest");
      for (let bank = 0; bank < 2; bank++)
        for (let i = 0; i < chunks; i++)
          await this.store
            .remove(`pending-${bank}-${i}`)
            .catch(() => undefined);
    });
  }
  purge(): Promise<void> {
    return this.serial(async () => {
      for (let bank = 0; bank < 2; bank++)
        for (let i = 0; i < chunks; i++)
          await this.store.remove(`pending-${bank}-${i}`);
      await this.store.remove("pending-manifest");
    });
  }
}
export function validWrite(w: unknown): w is PendingWrite {
  if (!w || typeof w !== "object") return false;
  const p = w as PendingWrite;
  return (
    typeof p.id === "string" &&
    p.id.length > 0 &&
    typeof p.key === "string" &&
    p.key.length > 0 &&
    !!p.payload &&
    ["job", "note", "interview"].includes(p.payload.kind) &&
    Number.isInteger(p.payload.version) &&
    p.payload.version >= 0 &&
    (p.payload.job === null || typeof p.payload.job === "string") &&
    !!p.payload.body &&
    typeof p.payload.body === "object" &&
    !Array.isArray(p.payload.body)
  );
}
export class JournalRepository implements Repository {
  private writing = false;
  constructor(
    private api: Repository,
    readonly journal: WriteJournal,
    private guard: () => void = () => {},
  ) {}
  list() {
    return this.api.list();
  }
  attachments(id: string) {
    return this.api.attachments(id);
  }
  async save(input: PendingWrite): Promise<BoardRecord> {
    if (this.writing)
      throw new BoardError(
        "invalid",
        "Another operation is already in progress.",
      );
    this.writing = true;
    try {
      this.guard();
      const write = JSON.parse(JSON.stringify(input)) as PendingWrite;
      if (!validWrite(write))
        throw new BoardError(
          "forbidden",
          "Mobile writes support jobs, notes and interview preparation.",
        );
      const pending = await this.journal.read();
      this.guard();
      if (pending && JSON.stringify(pending) !== JSON.stringify(write))
        throw new BoardError(
          "conflict",
          "Review the interrupted operation before starting another edit.",
        );
      if (!pending) {
        await this.journal.put(write);
        this.guard();
        const records = await this.api.list();
        const current = records.find((r) => r.id === write.id);
        if ((current?.version ?? 0) !== write.payload.version)
          throw new BoardError(
            "conflict",
            "This record changed. Review the pending draft against the latest record.",
          );
      }
      // An interrupted request may already have committed: retry EXACT body/key/version.
      this.guard();
      const result = await this.api.save(write);
      this.guard();
      try {
        await this.journal.clear();
      } catch {
        throw new BoardError(
          "network",
          "Save may have completed. Retry the same operation to confirm it.",
        );
      }
      return result;
    } finally {
      this.writing = false;
    }
  }
}
