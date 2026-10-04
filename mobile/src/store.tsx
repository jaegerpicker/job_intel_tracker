import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { BoardError, BoardRecord, Repository } from "./domain";
import { DemoRepository } from "./demo";
import { AppRuntime } from "./runtime";
const demo = new DemoRepository();
function useStore(repository: Repository, enabled = true) {
  const generation = useRef(0);
  const [records, setRecords] = useState<BoardRecord[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!enabled) return;
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await repository.list();
      if (request === generation.current) setRecords(result);
    } catch (e) {
      if (request === generation.current) {
        if (
          e instanceof BoardError &&
          ["unauthorized", "forbidden"].includes(e.code)
        )
          setRecords([]);
        setError(e instanceof Error ? e.message : "Unable to load board");
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [repository, enabled]);
  useEffect(() => {
    // Initial loading is already true; schedule the external read after mounting.
    let cancelled = false;
    const requests = generation;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
      requests.current++;
    };
  }, [load]);
  const updateRecord = (record: BoardRecord) => {
    generation.current++;
    setError("");
    setLoading(false);
    setRecords((prev) => [record, ...prev.filter((r) => r.id !== record.id)]);
  };
  return { records, loading, error, load, updateRecord, repository };
}
const Context = createContext<
  | (ReturnType<typeof useStore> &
      Pick<AppRuntime, "mode" | "canWrite" | "lockedReason">)
  | null
>(null);
export function BoardProvider({
  children,
  repository = demo,
  runtime,
}: {
  children: React.ReactNode;
  repository?: Repository;
  runtime?: AppRuntime;
}) {
  const store = useStore(
    runtime?.repository ?? repository,
    !runtime?.lockedReason,
  );
  const value = {
    ...store,
    mode: runtime?.mode ?? ("demo" as const),
    canWrite: runtime?.canWrite ?? true,
    lockedReason: runtime?.lockedReason,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useBoard() {
  const store = useContext(Context);
  if (!store) throw new Error("BoardProvider is required");
  return store;
}
