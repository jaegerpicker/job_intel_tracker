import { packages, ResearchPackage } from "./research";
import React, { useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Button, Field, Notice, styles as s } from "./components";
import { safeSource } from "./domain";
import {
  deliverableLabels,
  MaterialCoverage,
  prepareResearchDraft,
  ResearchDraft,
  researchDeliverables,
  ResearchRequestView,
} from "./research-view";

const packageLabels: Record<ResearchPackage, string> = {
  research: "Job & company research",
  application_documents: "Tailored resume & cover letter",
  interview_prep: "Interview prep",
  full_package: "Full package",
};
/** Render only actual snapshot results. Requesting work never claims an agent did it. */
export function ResearchPanel({
  jobId,
  coverage,
  requests,
  loading,
  error,
  busy,
  canWrite,
  unavailable,
  onRetry,
  onRequest,
  onCancel,
  onRequeue,
  onOpenSource,
}: {
  jobId: string;
  coverage?: MaterialCoverage[];
  requests: ResearchRequestView[];
  loading: boolean;
  error: string;
  busy: boolean;
  canWrite: boolean;
  unavailable?: string;
  onRetry: () => void;
  onRequest: (draft: ResearchDraft) => Promise<boolean>;
  onCancel: (request: ResearchRequestView) => void;
  onRequeue?: (request: ResearchRequestView) => void;
  onOpenSource: (source: string) => void;
}) {
  const [selected, setSelected] = useState<ResearchPackage>("full_package");
  const submission = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [validation, setValidation] = useState("");
  const disabled =
    busy || submitting || loading || !!error || !canWrite || !!unavailable;
  const jobRequests = requests.filter((r) => r.jobId === jobId);
  const active = jobRequests.some((r) =>
    ["queued", "claimed", "blocked"].includes(r.status),
  );
  const submit = async () => {
    if (submission.current || disabled || active) return;
    let draft: ResearchDraft;
    try {
      draft = prepareResearchDraft(selected, instructions);
    } catch {
      setValidation(
        "Choose a package and keep instructions under 4,000 characters.",
      );
      return;
    }
    submission.current = true;
    setSubmitting(true);
    setValidation("");
    try {
      if (await onRequest(draft)) setInstructions("");
    } catch {
      setValidation(
        "Request could not be confirmed. Your instructions are retained.",
      );
    } finally {
      submission.current = false;
      setSubmitting(false);
    }
  };
  return (
    <View>
      <Text style={s.section}>Research requests</Text>
      <Text style={s.subtitle}>
        Ask for a deeper look and materials tailored to this role. Work begins
        when an authorized agent picks it up.
      </Text>
      <Text style={s.cardTitle}>Material coverage</Text>
      {coverage ? (
        researchDeliverables.map((type) => (
          <Text key={type} style={s.text}>
            {deliverableLabels[type]} ·{" "}
            {coverage.find((c) => c.type === type)?.available
              ? "Available"
              : "Missing"}
          </Text>
        ))
      ) : (
        <Text style={s.subtitle}>Material coverage has not loaded.</Text>
      )}
      {loading && (
        <ActivityIndicator accessibilityLabel="Loading research requests" />
      )}
      {!!error && (
        <>
          <Notice text={error} />
          <Button
            label="Retry research requests"
            quiet
            disabled={busy}
            onPress={onRetry}
          />
        </>
      )}
      {!!unavailable && <Notice text={unavailable} />}
      <Text style={s.section}>Requested deliverables</Text>
      {packages.map((choice) => (
        <Pressable
          key={choice}
          accessibilityRole="radio"
          accessibilityLabel={packageLabels[choice]}
          accessibilityState={{ selected: selected === choice, disabled }}
          disabled={disabled}
          style={[s.chip, { marginVertical: 4 }]}
          onPress={() => setSelected(choice)}
        >
          <Text style={s.text}>
            {selected === choice ? "● " : "○ "}
            {packageLabels[choice]}
          </Text>
        </Pressable>
      ))}
      <Field
        label="Research instructions (optional)"
        value={instructions}
        multiline
        disabled={disabled}
        onChange={setInstructions}
      />
      {!!validation && <Notice text={validation} />}
      {active && (
        <Notice text="This job already has active requested work. Follow its progress below or cancel it before requesting again." />
      )}
      <Button
        label="Request research"
        disabled={disabled || active}
        onPress={() => void submit()}
      />
      {!loading && !error && !unavailable && !jobRequests.length && (
        <Text style={s.subtitle}>
          No requests yet. Nothing has been queued.
        </Text>
      )}
      {jobRequests.map((r) => (
        <View key={r.id} style={[s.card, { marginTop: 16 }]}>
          <Text accessibilityLiveRegion="polite" style={s.cardTitle}>
            {r.status[0].toUpperCase() + r.status.slice(1)}
            {r.claimedBy ? ` · ${r.claimedBy}` : ""}
          </Text>
          <Text style={s.text}>
            {r.deliverables.map((d) => deliverableLabels[d]).join(" · ")}
          </Text>
          {!!r.instructions && (
            <Text selectable style={s.text}>
              {r.instructions}
            </Text>
          )}
          {!!r.detail && <Notice text={r.detail} />}
          {!!r.missing?.length && (
            <Notice
              text={`Missing deliverables: ${r.missing.map((d) => deliverableLabels[d]).join(", ")}`}
            />
          )}
          {!!r.leaseUntil && (
            <Text style={s.label}>
              Claim lease until {new Date(r.leaseUntil * 1000).toISOString()}
            </Text>
          )}
          {r.history?.map((event, index) => (
            <Text key={index} style={s.label}>
              {event}
            </Text>
          ))}
          {!r.results.length && (
            <Text style={s.subtitle}>No delivered artifacts yet.</Text>
          )}
          {r.results.map((result) => (
            <View key={result.id} style={{ gap: 8 }}>
              <Text style={s.cardTitle}>{result.title}</Text>
              <Text style={s.label}>
                {deliverableLabels[result.type]}
                {result.author ? ` · ${result.author}` : ""}
              </Text>
              {!!result.observedOn && (
                <Text style={s.label}>
                  Observed {result.observedOn} · artifact version{" "}
                  {result.version}
                </Text>
              )}
              {!!result.text && (
                <Text selectable style={s.text}>
                  {result.text}
                </Text>
              )}
              {!!result.filename && (
                <Text style={s.subtitle}>
                  {result.filename} · attachment metadata; private downloads
                  remain unavailable.
                </Text>
              )}
              {safeSource(result.source) && (
                <Button
                  label={`Open source for ${result.title}`}
                  quiet
                  onPress={() => onOpenSource(safeSource(result.source)!)}
                />
              )}
            </View>
          ))}
          {r.status === "blocked" && onRequeue && (
            <Button
              label="Requeue blocked request"
              quiet
              disabled={disabled}
              onPress={() => onRequeue(r)}
            />
          )}
          {["queued", "claimed", "blocked"].includes(r.status) && (
            <Button
              label={`Cancel ${r.status} request`}
              quiet
              disabled={disabled}
              onPress={() => onCancel(r)}
            />
          )}
        </View>
      ))}
    </View>
  );
}
