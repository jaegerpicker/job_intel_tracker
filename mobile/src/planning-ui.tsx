import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { BoardRecord, PendingWrite, prepareWrite } from "./domain";
import { DerivedJob, Tracking, Workload, parseTracking } from "./planning";
import { Button, Field, Notice, styles as s, colors } from "./components";
export function PlanningSummary({
  data,
  error,
  loading,
  retry,
}: {
  data?: Workload;
  error: string;
  loading: boolean;
  retry: () => void;
}) {
  if (loading)
    return (
      <ActivityIndicator
        accessibilityLabel="Loading planning"
        color={colors.green}
      />
    );
  if (error)
    return (
      <View>
        <Notice text={error} />
        <Button label="Retry planning" quiet onPress={retry} />
      </View>
    );
  if (!data)
    return (
      <Notice text="Planning is unavailable until the server supports workload reads." />
    );
  return (
    <View style={s.card}>
      <Text style={s.section}>Search workload</Text>
      <Text style={s.cardTitle}>
        {data.counts.open_applications} /{" "}
        {String(data.policy.open_application_limit)} active applications
      </Text>
      <Text style={s.text}>
        {data.counts.interviewing_companies} /{" "}
        {String(data.policy.interviewing_company_limit)} interviewing companies
      </Text>
      <Text style={s.text}>
        {data.counts.weekly_new} / {String(data.policy.weekly_new_limit)} new
        this week · planning guidance
      </Text>
      <Text style={s.label}>
        {data.counts.passive_waiting} passive waiting · {data.counts.attention}{" "}
        attention · {data.counts.parked} parked
      </Text>
      <Text style={s.subtitle}>
        As of {data.local_date} · {data.timezone}. Thresholds advise; they do
        not block recording.
      </Text>
      {data.warnings.map((w) => (
        <Notice key={w.code} text={w.message} />
      ))}
    </View>
  );
}
export function AttentionBadge({
  value,
  version,
}: {
  value?: DerivedJob;
  version: number;
}) {
  if (!value || value.record_version !== version)
    return <Text style={s.label}>Planning refresh needed</Text>;
  return (
    <Text style={value.needs_decision ? s.text : s.label}>{value.label}</Text>
  );
}
function Choice({
  label,
  items,
  value,
  onChange,
  disabled,
}: {
  label: string;
  items: readonly string[];
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <View style={s.row}>
        {items.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${item.replaceAll("_", " ")}`}
            accessibilityState={{ selected: value === item, disabled }}
            disabled={disabled}
            onPress={() => onChange(item)}
            style={[s.chip, value === item && s.chipSelected]}
          >
            <Text style={[s.chipText, value === item && { color: "white" }]}>
              {item.replaceAll("_", " ")}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
const dates = [
  ["applied_on", "applied_source", "Application"],
  ["shortlisted_on", "shortlisted_source", "Shortlisted"],
  ["interview_on", "interview_source", "Scheduled interview"],
  ["promised_response_on", "promise_source", "Promised response"],
] as const;
export function PlanningEditor({
  job,
  derived,
  localDate,
  canWrite,
  busy,
  onSave,
  onRefresh,
}: {
  job: BoardRecord;
  derived?: DerivedJob;
  localDate?: string;
  canWrite: boolean;
  busy: boolean;
  onSave: (w: PendingWrite) => Promise<BoardRecord | undefined>;
  onRefresh: () => void;
}) {
  const [draft, setDraft] = useState<Tracking | null>(() => {
    try {
      return structuredClone(parseTracking(job.body.tracking ?? {}));
    } catch {
      return null;
    }
  });
  const [baseVersion, setBaseVersion] = useState(job.version);
  const [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const [contact, setContact] = useState({
    on: "",
    source: "",
    kind: "human" as "human" | "receipt" | "outbound",
  });
  const [review, setReview] = useState(""),
    [reviewSource, setReviewSource] = useState("");
  const [reviewOn, setReviewOn] = useState<string>();
  const stale =
    !derived ||
    derived.record_version !== job.version ||
    baseVersion !== job.version;
  const disabled = !canWrite || busy || saving || stale || !localDate;
  if (!draft)
    return (
      <Notice text="Stored tracking is invalid. Review it on the source board before mobile editing. No dates were inferred." />
    );
  const patch = (value: Partial<Tracking>) => {
    setDraft({ ...draft, ...value });
    setDirty(true);
    setError("");
  };
  const save = async () => {
    if (disabled) return;
    try {
      if (reviewSource.trim() && !review)
        throw new Error("Choose a review decision.");
      const next: Tracking = { ...draft };
      if (contact.on || contact.source)
        next.contacts = [
          ...(draft.contacts ?? []),
          { id: randomUUID().replace(/[^A-Za-z0-9_-]/g, ""), ...contact },
        ];
      if (review)
        next.review = {
          decision: review as "keep_waiting" | "prepare_follow_up" | "park",
          on: reviewOn ?? localDate!,
          source: reviewSource,
        };
      parseTracking(next, localDate);
      setSaving(true);
      const result = await onSave(
        prepareWrite(job, { tracking: next }, randomUUID()),
      );
      if (result) {
        setDraft(structuredClone(parseTracking(result.body.tracking ?? {})));
        setBaseVersion(result.version);
        setDirty(false);
        setContact({ on: "", source: "", kind: "human" });
        setReview("");
        setReviewSource("");
        setReviewOn(undefined);
      }
    } catch {
      setError(
        "Use valid YYYY-MM-DD dates and provide a source for every observation, task and review. Observed dates cannot be in the future.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <View>
      <Text style={s.section}>Waiting and next action</Text>
      <AttentionBadge value={derived} version={job.version} />
      {derived?.record_version === job.version &&
        derived.reasons.map((reason, i) => (
          <Text key={i} style={s.subtitle}>
            {reason}
          </Text>
        ))}
      <Text style={s.subtitle}>
        Blank means unknown. Receipts and outbound messages do not reset
        waiting. Assignment does not grant agent access.
      </Text>
      {stale && (
        <View>
          <Notice text="Planning and record versions must agree before editing. Refresh and review your retained draft." />
          <Button
            label="Refresh planning and records"
            quiet
            onPress={onRefresh}
          />
        </View>
      )}
      {baseVersion !== job.version && (
        <Button
          label="Load latest planning draft"
          quiet
          onPress={() => {
            try {
              setDraft(structuredClone(parseTracking(job.body.tracking ?? {})));
              setBaseVersion(job.version);
              setDirty(false);
              setReview("");
              setReviewSource("");
              setReviewOn(undefined);
              setError("");
              setContact({ on: "", source: "", kind: "human" });
            } catch {
              setError("Latest tracking needs source-board review.");
            }
          }}
        />
      )}
      {dates.map(([date, source, label]) => (
        <View key={date}>
          <Field
            label={`${label} date (YYYY-MM-DD)`}
            value={draft[date] ?? ""}
            disabled={disabled}
            onChange={(v) => patch({ [date]: v || null })}
          />
          <Field
            label={`${label} source`}
            value={draft[source] ?? ""}
            disabled={disabled}
            onChange={(v) => patch({ [source]: v })}
          />
        </View>
      ))}
      <Text style={s.section}>Next action</Text>
      <Field
        label="Next action"
        value={draft.next_action?.text ?? ""}
        disabled={disabled}
        onChange={(v) =>
          patch({
            next_action: {
              ...draft.next_action,
              text: v,
              owner: draft.next_action?.owner ?? "owner",
              source: draft.next_action?.source ?? "",
            },
          })
        }
      />
      <Choice
        label="Action owner"
        items={["owner", "company", "agent"]}
        value={draft.next_action?.owner ?? "owner"}
        disabled={disabled}
        onChange={(v) =>
          patch({
            next_action: {
              text: draft.next_action?.text ?? "",
              source: draft.next_action?.source ?? "",
              ...draft.next_action,
              owner: v as "owner" | "company" | "agent",
            },
          })
        }
      />
      <Field
        label="Action due date (YYYY-MM-DD)"
        value={draft.next_action?.due_on ?? ""}
        disabled={disabled}
        onChange={(v) =>
          patch({
            next_action: {
              text: draft.next_action?.text ?? "",
              owner: draft.next_action?.owner ?? "owner",
              source: draft.next_action?.source ?? "",
              ...draft.next_action,
              due_on: v || null,
            },
          })
        }
      />
      <Field
        label="Action source"
        value={draft.next_action?.source ?? ""}
        disabled={disabled}
        onChange={(v) =>
          patch({
            next_action: {
              text: draft.next_action?.text ?? "",
              owner: draft.next_action?.owner ?? "owner",
              ...draft.next_action,
              source: v,
            },
          })
        }
      />
      <Field
        label="Action assignee (optional)"
        value={draft.next_action?.assignee ?? ""}
        disabled={disabled}
        onChange={(v) =>
          patch({
            next_action: {
              text: draft.next_action?.text ?? "",
              owner: draft.next_action?.owner ?? "owner",
              source: draft.next_action?.source ?? "",
              ...draft.next_action,
              assignee: v,
            },
          })
        }
      />
      <Button
        label="Clear next action"
        quiet
        disabled={disabled || !draft.next_action}
        onPress={() => patch({ next_action: null })}
      />
      <Text style={s.section}>Record contact</Text>
      {(draft.contacts ?? []).map((c) => (
        <Text key={c.id} style={s.text}>
          {c.on} · {c.kind} · {c.source}
        </Text>
      ))}
      <Choice
        label="Contact kind"
        items={["human", "receipt", "outbound"]}
        value={contact.kind}
        disabled={disabled}
        onChange={(v) => {
          setContact({ ...contact, kind: v as typeof contact.kind });
          setDirty(true);
        }}
      />
      <Field
        label="Contact date (YYYY-MM-DD)"
        value={contact.on}
        disabled={disabled}
        onChange={(v) => {
          setContact({ ...contact, on: v });
          setDirty(true);
        }}
      />
      <Field
        label="Contact source"
        value={contact.source}
        disabled={disabled}
        onChange={(v) => {
          setContact({ ...contact, source: v });
          setDirty(true);
        }}
      />
      <Text style={s.section}>Owner review</Text>
      {draft.review && (
        <Text style={s.text}>
          {draft.review.decision.replaceAll("_", " ")} · {draft.review.on} ·{" "}
          {draft.review.source}
        </Text>
      )}
      <Choice
        label="Review decision"
        items={["keep_waiting", "prepare_follow_up", "park"]}
        value={review}
        disabled={disabled}
        onChange={(v) => {
          setReview(v);
          setDirty(true);
        }}
      />
      {review && (
        <Field
          label="Review date (YYYY-MM-DD; confirm observed date)"
          value={reviewOn ?? localDate ?? ""}
          disabled={disabled}
          onChange={(v) => {
            setReviewOn(v);
            setDirty(true);
          }}
        />
      )}
      <Field
        label="Review source"
        value={reviewSource}
        disabled={disabled}
        onChange={(v) => {
          setReviewSource(v);
          setDirty(true);
        }}
      />
      {!!error && <Notice text={error} />}
      <Button
        label={saving ? "Saving planning…" : "Save planning"}
        disabled={disabled || !dirty}
        onPress={() => void save()}
      />
    </View>
  );
}
