import { useCallback, useEffect, useRef, useState } from "react";
import { BoardRecord, Repository } from "./domain";
import { Workload } from "./planning";
export function useWorkload(
  repository: Repository,
  records: BoardRecord[],
  enabled: boolean,
) {
  const [data, setData] = useState<Workload>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!enabled || !repository.workload) return;
    setData(undefined);
    setError("");
    setLoading(true);
    try {
      const result = await repository.workload();
      if (request === generation.current) setData(result);
    } catch {
      if (request === generation.current)
        setError(
          "Planning could not be loaded. Your records and drafts are preserved.",
        );
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [repository, enabled]);
  useEffect(() => {
    let cancelled = false;
    const requests = generation;
    void Promise.resolve().then(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
      requests.current++;
    };
  }, [records, refresh]);
  return {
    data: enabled ? data : undefined,
    error: enabled ? error : "",
    loading: enabled && !!repository.workload && loading,
    refresh,
    supported: !!repository.workload,
  };
}
