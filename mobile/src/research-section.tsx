import React, { useCallback, useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { Attachment, BoardError, BoardRecord, Repository } from "./domain";
import { ResearchOperation, ResearchRequest } from "./research";
import { ResearchPanel } from "./research-ui";
import {
  ResearchDraft,
  ResearchRequestView,
  researchDeliverables,
} from "./research-view";
import { Button, Notice } from "./components";

export function ResearchSection({
  jobId,
  records,
  repository,
  canWrite,
  busy,
  enabled = true,
  onBusyChange,
  mode = "live",
  onRefreshBoard,
}: {
  jobId: string;
  records: BoardRecord[];
  repository: Repository;
  canWrite: boolean;
  busy: boolean;
  enabled?: boolean;
  onBusyChange: (value: boolean) => void;
  mode?: "demo" | "live";
  onRefreshBoard?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<{
    jobId: string;
    rows: ResearchRequest[];
    files: Attachment[];
  }>();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [pending, setPending] = useState<ResearchOperation>(),
    [writing, setWriting] = useState(false);
  const [conflict, setConflict] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const generation = useRef(0),
    mounted = useRef(true),
    lock = useRef(false);
  const load = useCallback(async () => {
    if (!enabled || !repository.researchRequests) return;
    const n = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const [rows, files] = await Promise.all([
        repository.researchRequests(jobId),
        repository.attachments(jobId),
      ]);
      if (mounted.current && n === generation.current) {
        setSnapshot({ jobId, rows, files });
        setReviewed(true);
      }
    } catch {
      if (mounted.current && n === generation.current)
        setError("Research progress could not be loaded. Retry to refresh it.");
    } finally {
      if (mounted.current && n === generation.current) setLoading(false);
    }
  }, [enabled, jobId, repository]);
  useEffect(() => {
    mounted.current = true;
    let canceled = false;
    const counter = generation;
    void Promise.resolve().then(() => {
      if (!canceled) void load();
    });
    return () => {
      canceled = true;
      mounted.current = false;
      counter.current++;
    };
  }, [load]);
  useEffect(() => {
    onBusyChange(writing || !!pending);
    return () => onBusyChange(false);
  }, [onBusyChange, writing, pending]);
  const send = async (operation: ResearchOperation) => {
    if (lock.current || !enabled || !canWrite || !repository.researchWrite)
      return false;
    lock.current = true;
    setWriting(true);
    setError("");
    setReviewed(false);
    setPending(structuredClone(operation));
    onBusyChange(true);
    generation.current++;
    try {
      await repository.researchWrite(operation);
      if (mounted.current) {
        setPending(undefined);
        setConflict(false);
        await load();
      }
      return true;
    } catch (e) {
      const definitelyNotSent = repository.researchPending
        ? await repository
            .researchPending()
            .then((p) => p === null)
            .catch(() => false)
        : false;
      if (mounted.current) {
        if (definitelyNotSent) {
          setPending(undefined);
          onBusyChange(false);
        }
        const knownConflict = e instanceof BoardError && e.code === "conflict";
        setConflict(knownConflict);
        setError(
          knownConflict
            ? "Research progress changed. Refresh before reviewing this operation."
            : "Request could not be confirmed. Retry the same operation to recover.",
        );
      }
      return false;
    } finally {
      lock.current = false;
      if (mounted.current) setWriting(false);
    }
  };
  const currentSnapshot = snapshot?.jobId === jobId ? snapshot : undefined;
  const views: ResearchRequestView[] = (currentSnapshot?.rows ?? []).map(
    (r) => ({
      id: r.id,
      jobId: r.job,
      version: r.version,
      status: r.status,
      deliverables: r.required_deliverables,
      instructions: r.note,
      claimedBy: r.claimed_by ?? undefined,
      leaseUntil: r.lease_until ?? undefined,
      detail: [
        r.reason,
        r.completion_note,
        r.claim_expired
          ? "Previous claim expired; available for an authorized agent."
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      missing: [
        ...new Set([
          ...r.missing_deliverables,
          ...r.artifacts
            .filter((a) => a.availability !== "available")
            .map((a) => a.deliverable),
        ]),
      ],
      history: r.events.map(
        (e) =>
          `${e.action} · ${e.actor} · ${new Date(e.timestamp * 1000).toISOString()}`,
      ),
      results: r.artifacts.map((a) => {
        const record = records.find(
          (v) =>
            v.id === a.id &&
            v.job === jobId &&
            v.version === a.version &&
            ((a.deliverable === "research" && v.kind === "research") ||
              (a.deliverable === "interview_prep" && v.kind === "interview")),
        );
        const file = currentSnapshot?.files.find(
          (f) => f.id === a.id && f.job === jobId && f.version === a.version,
        );
        return {
          id: `${a.deliverable}-${a.id}`,
          type: a.deliverable,
          title:
            a.availability === "available"
              ? `Delivered ${a.deliverable.replaceAll("_", " ")}`
              : `${a.deliverable.replaceAll("_", " ")} · ${a.availability}`,
          text:
            a.availability === "available" &&
            a.type === "record" &&
            record &&
            typeof record.body.text === "string"
              ? record.body.text
              : a.type === "record" && a.availability === "available"
                ? "Record preview unavailable or changed. Refresh the board."
                : undefined,
          filename:
            a.availability === "available" && a.type === "attachment"
              ? file?.filename
              : undefined,
          source: a.source,
          author: record?.author ?? file?.author,
          observedOn: a.observed_on,
          version: a.version,
        };
      }),
    }),
  );
  const coverage = currentSnapshot
    ? researchDeliverables.map((type) => ({
        type,
        available:
          ((type === "research" || type === "interview_prep") &&
            records.some(
              (r) =>
                r.job === jobId &&
                r.kind === (type === "research" ? "research" : "interview") &&
                typeof r.body.text === "string" &&
                !!r.body.text.trim(),
            )) ||
          currentSnapshot.rows.some((r) =>
            r.artifacts.some(
              (a) => a.deliverable === type && a.availability === "available",
            ),
          ),
      }))
    : undefined;
  const act = (view: ResearchRequestView, action: "cancel" | "requeue") => {
    if (pending || busy || !snapshot) return;
    const latest = snapshot.rows.find(
      (r) => r.id === view.id && r.job === jobId,
    );
    if (latest)
      void send({
        key: randomUUID(),
        job: jobId,
        id: latest.id,
        action,
        payload: { version: latest.version },
      });
  };
  return (
    <View>
      <ResearchPanel
        jobId={jobId}
        coverage={coverage}
        requests={views}
        loading={enabled && !!repository.researchRequests && loading}
        error={error}
        busy={busy || writing || !!pending}
        canWrite={canWrite && enabled}
        unavailable={
          !repository.researchRequests
            ? "Research requests are unavailable on this server."
            : undefined
        }
        onRetry={() => void load()}
        onRequest={(draft: ResearchDraft) =>
          send({
            key: randomUUID(),
            job: jobId,
            action: "request",
            payload: { package: draft.package, note: draft.instructions },
          })
        }
        onCancel={(r) => act(r, "cancel")}
        onRequeue={(r) => act(r, "requeue")}
        onOpenSource={(source) =>
          void Linking.openURL(source).catch(() =>
            setError("Source could not be opened."),
          )
        }
      />
      {onRefreshBoard && (
        <Button
          label="Refresh board materials"
          quiet
          disabled={writing || !!pending}
          onPress={onRefreshBoard}
        />
      )}
      {!!pending && (
        <>
          <Notice text="An operation is pending. Navigation and new edits are paused until its outcome is confirmed." />
          <Button
            label="Retry same research operation"
            disabled={writing || !canWrite || !enabled}
            onPress={() => void send(pending)}
          />
          {conflict && (
            <Button
              label="Refresh research progress"
              quiet
              disabled={writing}
              onPress={() => void load()}
            />
          )}
          {conflict && reviewed && mode === "demo" && (
            <Button
              label="Discard reviewed research operation"
              quiet
              disabled={writing}
              onPress={() => {
                setPending(undefined);
                setError("");
                setConflict(false);
                setReviewed(false);
              }}
            />
          )}
          {conflict && reviewed && mode === "live" && (
            <Notice text="Live pending work must be reviewed and discarded through the secure recovery screen before editing again." />
          )}
        </>
      )}
    </View>
  );
}
