import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { BoardRecord, Repository } from "./domain";
import { DemoRepository } from "./demo";
const demo = new DemoRepository();
function useStore(repository: Repository) {
  const generation = useRef(0);
  const [records, setRecords] = useState<BoardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await repository.list();
      if (request === generation.current) setRecords(result);
    } catch (e) {
      if (request === generation.current)
        setError(e instanceof Error ? e.message : "Unable to load board");
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [repository]);
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
const Context = createContext<ReturnType<typeof useStore> | null>(null);
export function BoardProvider({
  children,
  repository = demo,
}: {
  children: React.ReactNode;
  repository?: Repository;
}) {
  const store = useStore(repository);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useBoard() {
  const store = useContext(Context);
  if (!store) throw new Error("BoardProvider is required");
  return store;
}
