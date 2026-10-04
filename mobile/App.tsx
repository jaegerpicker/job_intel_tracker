import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { randomUUID } from "expo-crypto";
import {
  Attachment,
  BoardError,
  BoardRecord,
  PendingWrite,
  Stage,
  active,
  filterJobs,
  prepareWrite,
  safeSource,
  stages,
} from "./src/domain";
import { useBoard } from "./src/store";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Field, Notice, colors, styles as s } from "./src/components";

type Tab = "Overview" | "Notes" | "Prep" | "Evidence";
type ScreenProps = { selectedId?: string; creating?: boolean };
export default function App(props: ScreenProps) {
  return <BoardApp {...props} />;
}
export function BoardApp({ selectedId, creating = false }: ScreenProps) {
  const {
    records,
    updateRecord,
    loading,
    error,
    load,
    repository,
    mode,
    canWrite,
    lockedReason,
  } = useBoard();
  const router = useRouter();
  const selected = selectedId ?? null;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [tab, setTab] = useState<Tab>("Overview");
  const [drafts, setDrafts] = useState<Partial<Record<Tab, string>>>({});
  const draft = drafts[tab] ?? "";
  const setDraft = (value: string) =>
    setDrafts((previous) => ({ ...previous, [tab]: value }));
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const saveLock = useRef(false);
  const fileGeneration = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (selected || creating) {
          if (!pending && !saving) router.dismissTo("/");
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [selected, creating, pending, saving, router]),
  );
  const job = records.find((r) => r.id === selected);
  const policy = records.find((r) => r.kind === "filters");
  const loadFiles = useCallback(async () => {
    if (!selected) return;
    const request = ++fileGeneration.current;
    setFilesLoading(true);
    setFileError("");
    try {
      const result = await repository.attachments(selected);
      if (request === fileGeneration.current) setFiles(result);
    } catch (e) {
      if (request === fileGeneration.current)
        setFileError(
          e instanceof Error ? e.message : "Unable to load materials",
        );
    } finally {
      if (request === fileGeneration.current) setFilesLoading(false);
    }
  }, [repository, selected]);
  useEffect(() => {
    setFiles([]);
    if (tab === "Evidence") void loadFiles();
    return () => {
      fileGeneration.current++;
    };
  }, [tab, loadFiles]);
  async function save(write: PendingWrite) {
    if (!canWrite || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setPending(write);
    setSaveError("");
    setMessage("");
    try {
      const result = await repository.save(write);
      updateRecord(result);
      setPending(null);
      setDraft("");
      if (creating)
        router.replace({ pathname: "/job/[id]", params: { id: result.id } });
      setMessage(
        mode === "demo"
          ? "Saved to this demo session."
          : "Saved to your owner board.",
      );
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Unable to save");
      if (e instanceof BoardError && e.code !== "network") setPending(null);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  function open(id: string) {
    router.push({ pathname: "/job/[id]", params: { id } });
    setTab("Overview");
    setDraft("");
    setSaveError("");
    setMessage("");
  }
  const busy = saving || pending !== null;
  const back = () => {
    router.dismissTo("/");
    setDraft("");
    setMessage("");
    setSaveError("");
  };
  const chips = (
    items: readonly string[],
    current: string,
    choose: (v: string) => void,
    disabled = false,
  ) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, marginBottom: 16 }}
    >
      {items.map((item) => (
        <Pressable
          key={item}
          accessibilityRole="button"
          accessibilityState={{
            selected: item === current,
            disabled: busy || disabled,
          }}
          disabled={busy || disabled}
          onPress={() => choose(item)}
          style={[s.chip, current === item && s.chipSelected]}
        >
          <Text style={[s.chipText, current === item && { color: "#FFFFFF" }]}>
            {item}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
  if (lockedReason)
    return (
      <SafeAreaView style={s.root}>
        <View style={s.header}>
          <Text style={s.eyebrow}>FIELDNOTES / JOB INTEL</Text>
          <Text style={s.title}>Live connection locked</Text>
          <Notice text={lockedReason} />
          <Text style={s.subtitle}>
            No API requests or credential creation occur in this state. Use demo
            mode for synthetic portfolio QA.
          </Text>
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.container}
      >
        <View style={s.header}>
          <Text style={s.eyebrow}>FIELDNOTES / JOB INTEL</Text>
          <Text style={s.title}>
            {job
              ? String(job.body.company)
              : creating
                ? "New opportunity"
                : "A more intentional search."}
          </Text>
          <Text style={s.subtitle}>
            {job
              ? String(job.body.title)
              : "Keep your next move grounded in evidence."}
          </Text>
          <Text style={s.badge}>
            {mode === "demo"
              ? "DEMO · SYNTHETIC DATA · RESETS ON RESTART"
              : canWrite
                ? "LIVE · OWNER SESSION · SECURE PENDING WORK"
                : "LIVE · OWNER READ ONLY · WRITES DISABLED"}
          </Text>
        </View>
        {selected || creating ? (
          <ScrollView
            contentContainerStyle={s.list}
            keyboardShouldPersistTaps="handled"
          >
            <Button
              label="← Back to board"
              onPress={back}
              disabled={busy}
              quiet
            />
            {!!message && (
              <View style={{ marginTop: 12 }}>
                <Notice text={message} />
              </View>
            )}
            {!!saveError && (
              <View style={{ marginTop: 12 }}>
                <Notice text={saveError} />
                <Button
                  label={
                    pending
                      ? "Retry same operation"
                      : "Reload latest; keep draft"
                  }
                  disabled={saving}
                  onPress={() => (pending ? void save(pending) : void load())}
                />
              </View>
            )}
            {loading && !records.length ? (
              <ActivityIndicator
                accessibilityLabel="Loading opportunity"
                color={colors.green}
              />
            ) : error ? (
              <>
                <Notice text={error} />
                <Button label="Retry opportunity" onPress={() => void load()} />
              </>
            ) : creating ? (
              <>
                <Field
                  label="Company"
                  value={company}
                  onChange={setCompany}
                  disabled={busy}
                />
                <Field
                  label="Role title"
                  value={title}
                  onChange={setTitle}
                  disabled={busy}
                />
                <Notice text="Starts in Prospect. This synthetic demo makes no external applications." />
                <Button
                  label={saving ? "Saving…" : "Create opportunity"}
                  disabled={
                    busy || !canWrite || !company.trim() || !title.trim()
                  }
                  onPress={() =>
                    void save({
                      id: randomUUID(),
                      key: randomUUID(),
                      payload: {
                        kind: "job",
                        job: null,
                        version: 0,
                        body: {
                          company: company.trim(),
                          title: title.trim(),
                          stage: "Prospect",
                          comp_status: "Unknown",
                          lane: "Product engineering",
                          route: "Discovered",
                        },
                      },
                    })
                  }
                />
              </>
            ) : job ? (
              <>
                <View style={{ marginTop: 20 }}>
                  {chips(
                    ["Overview", "Notes", "Prep", "Evidence"],
                    tab,
                    (v) => {
                      setTab(v as Tab);
                      setMessage("");
                    },
                  )}
                </View>
                {tab === "Overview" ? (
                  <>
                    <Text style={s.section}>Move with intention</Text>
                    <Text style={[s.label, { marginBottom: 10 }]}>
                      Current stage · {job.body.stage}
                    </Text>
                    {chips(
                      stages,
                      job.body.stage ?? "",
                      (stage) =>
                        void save(
                          prepareWrite(
                            job,
                            { stage: stage as Stage },
                            randomUUID(),
                          ),
                        ),
                      !canWrite,
                    )}
                    <View style={s.card}>
                      <Text style={s.label}>THE OPPORTUNITY</Text>
                      <Text style={s.text}>
                        {String(
                          job.body.description ??
                            "Add context as you learn more about this role.",
                        )}
                      </Text>
                      <Text style={s.subtitle}>
                        {String(job.body.location ?? "Location unconfirmed")} ·{" "}
                        {String(job.body.route ?? "Route unknown")}
                      </Text>
                      <Text style={s.text}>
                        {typeof job.body.base_min === "number"
                          ? `$${job.body.base_min.toLocaleString()}–$${Number(job.body.base_max ?? job.body.base_min).toLocaleString()} base`
                          : "Base compensation unknown"}
                      </Text>
                      <Text style={s.label}>
                        {String(job.body.comp_status ?? "Unknown")} · verify
                        source and date before relying on this range
                      </Text>
                    </View>
                    <Text style={s.section}>Status timeline</Text>
                    {Array.isArray(job.body.timeline) &&
                      job.body.timeline.map(
                        (
                          entry: { stage: string; at: number; author: string },
                          i: number,
                        ) => (
                          <View style={s.card} key={i}>
                            <Text style={s.cardTitle}>{entry.stage}</Text>
                            <Text style={s.label}>
                              {new Date(entry.at * 1000).toLocaleDateString()} ·{" "}
                              {entry.author}
                            </Text>
                          </View>
                        ),
                      )}
                  </>
                ) : tab === "Notes" || tab === "Prep" ? (
                  <>
                    <Text style={s.section}>
                      {tab === "Prep"
                        ? "Interview notebook"
                        : "Your working notes"}
                    </Text>
                    <Text style={s.subtitle}>
                      {tab === "Prep"
                        ? "Capture stories, questions, and what you want to learn."
                        : "Keep observations separate from verified evidence."}
                    </Text>
                    {records
                      .filter(
                        (r) =>
                          r.job === job.id &&
                          r.kind === (tab === "Prep" ? "interview" : "note"),
                      )
                      .map((r) => (
                        <View style={[s.card, { marginTop: 12 }]} key={r.id}>
                          <Text selectable style={s.text}>
                            {String(r.body.text ?? "")}
                          </Text>
                          <Text style={s.label}>
                            {r.author} · revision {r.version}
                          </Text>
                        </View>
                      ))}
                    {!records.some(
                      (r) =>
                        r.job === job.id &&
                        r.kind === (tab === "Prep" ? "interview" : "note"),
                    ) && (
                      <Notice text="A clean page. Add your first thought below." />
                    )}
                    <Field
                      label={
                        tab === "Prep"
                          ? "New interview preparation"
                          : "New note"
                      }
                      value={draft}
                      onChange={setDraft}
                      multiline
                      disabled={busy || !canWrite}
                    />
                    <Button
                      label={saving ? "Saving…" : "Save entry"}
                      disabled={busy || !canWrite || !draft.trim()}
                      onPress={() =>
                        void save({
                          id: randomUUID(),
                          key: randomUUID(),
                          payload: {
                            kind: tab === "Prep" ? "interview" : "note",
                            job: job.id,
                            version: 0,
                            body: { text: draft.trim() },
                          },
                        })
                      }
                    />
                  </>
                ) : (
                  <>
                    <Text style={s.section}>Independent perspectives</Text>
                    {records
                      .filter((r) => r.job === job.id && r.kind === "rating")
                      .map((r) => (
                        <View key={r.id} style={s.card}>
                          <Text style={s.cardTitle}>
                            {String(r.body.score)}/100 · {r.author}
                          </Text>
                          <Text style={s.text}>{String(r.body.rationale)}</Text>
                          <Text style={s.label}>
                            {String(r.body.rubric)}\nEvidence:{" "}
                            {String(r.body.evidence)}
                          </Text>
                        </View>
                      ))}
                    <Text style={s.section}>Research & provenance</Text>
                    {records
                      .filter((r) => r.job === job.id && r.kind === "research")
                      .map((r) => (
                        <View key={r.id} style={s.card}>
                          <Text selectable style={s.text}>
                            {String(r.body.text)}
                          </Text>
                          <Text style={s.label}>
                            {r.author} · observed {String(r.body.observed_at)}
                          </Text>
                          {safeSource(r.body.source) && (
                            <Button
                              label="Open research source ↗"
                              quiet
                              onPress={() =>
                                void Linking.openURL(
                                  safeSource(r.body.source)!,
                                ).catch(() =>
                                  setFileError("Unable to open source."),
                                )
                              }
                            />
                          )}
                        </View>
                      ))}
                    {!records.some(
                      (r) =>
                        r.job === job.id &&
                        ["rating", "research"].includes(r.kind),
                    ) && (
                      <Notice text="No research or ratings yet. Independent contributions stay separate." />
                    )}
                    <Text style={s.section}>Materials</Text>
                    {filesLoading ? (
                      <ActivityIndicator
                        accessibilityLabel="Loading materials"
                        color={colors.green}
                      />
                    ) : fileError ? (
                      <>
                        <Notice text={fileError} />
                        <Button
                          label="Retry materials"
                          onPress={() => void loadFiles()}
                        />
                      </>
                    ) : files.length ? (
                      files.map((f) => (
                        <View style={s.card} key={f.id}>
                          <Text style={s.text}>{f.filename}</Text>
                          <Text style={s.label}>
                            Version {f.version} · {f.author}
                          </Text>
                          <Text style={s.subtitle}>
                            {mode === "demo"
                              ? "Synthetic metadata only. Native downloads and uploads require approved authentication and a private file workflow."
                              : "Downloads and uploads await approved native private-file handling."}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <Notice text="No materials attached." />
                    )}
                  </>
                )}
              </>
            ) : (
              <Notice text="This opportunity is no longer available. Return to the board." />
            )}
          </ScrollView>
        ) : (
          <>
            <View style={{ paddingHorizontal: 24 }}>
              <View
                style={[s.card, s.row, { justifyContent: "space-between" }]}
              >
                <View>
                  <Text style={s.cardTitle}>
                    {records.filter(active).length} /{" "}
                    {String(policy?.body.active_cap ?? "—")}
                  </Text>
                  <Text style={s.label}>active opportunities</Text>
                </View>
                <View>
                  <Text style={s.cardTitle}>
                    ${Number(policy?.body.base_floor ?? 0).toLocaleString()}
                  </Text>
                  <Text style={s.label}>base salary floor</Text>
                </View>
              </View>
              <Field
                label="Search company, role, or lane"
                value={query}
                onChange={setQuery}
              />
              {chips(["All", ...stages], filter, setFilter)}
              <View
                style={[
                  s.row,
                  { justifyContent: "space-between", marginBottom: 16 },
                ]}
              >
                <Text style={s.section}>Your opportunities</Text>
                <Button
                  label="+ New"
                  disabled={!canWrite}
                  onPress={() => {
                    router.push("/new");
                    setCompany("");
                    setTitle("");
                  }}
                />
              </View>
            </View>
            {error ? (
              <View style={s.list}>
                <Notice text={error} />
                <Button label="Retry board" onPress={() => void load()} />
              </View>
            ) : loading && !records.length ? (
              <ActivityIndicator
                accessibilityLabel="Loading opportunities"
                size="large"
                color={colors.green}
              />
            ) : (
              <FlatList
                data={filterJobs(records, query, filter)}
                keyExtractor={(r) => r.id}
                contentContainerStyle={s.list}
                refreshControl={
                  <RefreshControl
                    refreshing={loading}
                    onRefresh={() => void load()}
                    tintColor={colors.green}
                  />
                }
                ListEmptyComponent={
                  <Notice text="No opportunities match. Try another search or create a prospect." />
                }
                renderItem={({ item }) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${item.body.company}, ${item.body.title}, ${item.body.stage}`}
                    onPress={() => open(item.id)}
                    style={({ pressed }) => [
                      s.card,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <View style={[s.row, { justifyContent: "space-between" }]}>
                      <Text style={s.badge}>
                        {item.body.stage?.toUpperCase()}
                      </Text>
                      <Text style={s.label}>↗</Text>
                    </View>
                    <Text style={s.cardTitle}>{item.body.company}</Text>
                    <Text style={s.text}>{item.body.title}</Text>
                    <Text style={s.label}>
                      {String(item.body.location ?? "Location unconfirmed")} ·{" "}
                      {String(item.body.lane ?? "Lane unassigned")}
                    </Text>
                  </Pressable>
                )}
              />
            )}
            <View
              style={{
                padding: 16,
                borderTopWidth: 1,
                borderColor: colors.line,
              }}
            >
              <Text style={[s.label, { textAlign: "center" }]}>
                {mode === "demo"
                  ? "Private by design · Live sign-in awaits secure mobile integration"
                  : "Owner board · Private file transfers remain unavailable"}
              </Text>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
