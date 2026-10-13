import React, { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Linking, ScrollView, Text, View } from "react-native";
import { MobileAuth } from "./auth";
import { createNativeAuth } from "./native-auth";
import { SecureWriteJournal } from "./journal";
import { createRuntime } from "./runtime";
import { BoardProvider } from "./store";
import { BoardRecord, PendingWrite } from "./domain";
import { Button, Notice, styles, colors } from "./components";
import { ResearchOperation } from "./research";
type Native = {
  auth: MobileAuth;
  journal: SecureWriteJournal;
  researchJournal?: SecureWriteJournal<ResearchOperation>;
};
export function LiveShell({
  origin,
  redirect,
  children,
}: {
  origin: string;
  redirect: string;
  children: React.ReactNode;
}) {
  const [native, setNative] = useState<Native>();
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void createNativeAuth(origin, redirect)
      .then(async (value) => {
        await value.auth.restore(async () => {
          await value.journal.purge();
          await value.researchJournal?.purge();
        });
        if (!cancelled) setNative(value);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Live setup requires native secure storage, a canonical HTTPS API origin and an approved claimed callback link.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [origin, redirect]);
  if (!native)
    return (
      <View style={styles.header}>
        <Notice text={error || "Opening native secure storage…"} />
      </View>
    );
  return (
    <PrivacyShield>
      <Authenticated native={native}>{children}</Authenticated>
    </PrivacyShield>
  );
}
function Authenticated({
  native: { auth, journal, researchJournal },
  children,
}: {
  native: Native;
  children: React.ReactNode;
}) {
  const snapshot = useSyncExternalStore(auth.subscribe, auth.getSnapshot);
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [researchPending, setResearchPending] =
    useState<ResearchOperation | null>(null);
  const [researchReviewed, setResearchReviewed] = useState(false);
  const [researchReady, setResearchReady] = useState(!researchJournal);
  const [researchLatest, setResearchLatest] = useState("");
  const [latest, setLatest] = useState<BoardRecord | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const runtime = React.useMemo(() => {
    const value = createRuntime({
      mode: "live",
      origin: auth.origin,
      session: snapshot.status === "signedIn" ? auth.source() : undefined,
      journal,
      researchJournal,
    });
    const save = value.repository.save.bind(value.repository);
    value.repository.save = async (write) => {
      try {
        return await save(write);
      } finally {
        await journal
          .read()
          .then(setPending)
          .catch(() =>
            setError(
              "Pending work could not be verified. Sign out to clear secure storage.",
            ),
          );
      }
    };
    if (value.repository.researchWrite) {
      const writeResearch = value.repository.researchWrite.bind(
        value.repository,
      );
      value.repository.researchWrite = async (operation) => {
        try {
          return await writeResearch(operation);
        } finally {
          await researchJournal
            ?.read()
            .then((value) => {
              setResearchPending(value);
              setResearchReviewed(false);
            })
            .catch(() =>
              setError(
                "Research pending work could not be verified. Sign out to clear secure storage.",
              ),
            );
        }
      };
    }
    return value;
  }, [auth, journal, researchJournal, snapshot]);
  useEffect(() => {
    const sub = Linking.addEventListener("url", (event) => {
      if (event.url.startsWith(auth.redirect + "?"))
        void auth.complete(event.url);
    });
    void Linking.getInitialURL().then((url) => {
      if (url && url.startsWith(auth.redirect + "?")) void auth.complete(url);
    });
    const state = AppState.addEventListener("change", (value) => {
      if (value === "active")
        void auth
          .source()
          ?.headers()
          .catch(() => undefined);
    });
    return () => {
      sub.remove();
      state.remove();
    };
  }, [auth]);
  useEffect(() => {
    let cancelled = false;
    void journal
      .read()
      .then((value) => {
        if (!cancelled) setPending(value);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Pending work could not be verified. Sign out to clear secure storage.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [journal, snapshot.revision]);
  useEffect(() => {
    let canceled = false;
    void researchJournal
      ?.read()
      .then((value) => {
        if (!canceled) {
          setResearchPending(value);
          setResearchReviewed(false);
          setResearchReady(true);
        }
      })
      .catch(() => {
        if (!canceled)
          setError(
            "Research pending work could not be verified. Sign out to clear secure storage.",
          );
      });
    return () => {
      canceled = true;
    };
  }, [researchJournal, snapshot.revision]);
  useEffect(() => {
    if (snapshot.status !== "signedIn") return;
    const timer = setInterval(() => {
      void auth
        .source()
        ?.headers()
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [auth, snapshot.status]);
  const logout = async () => {
    setWorking(true);
    await auth.logout(async () => {
      await journal.purge();
      await researchJournal?.purge();
    });
    setPending(null);
    setResearchPending(null);
    setResearchReviewed(false);
    setResearchReady(true);
    setLatest(null);
    setReviewed(false);
    setError("");
    setWorking(false);
  };
  const retry = async () => {
    if (!pending || working) return;
    setWorking(true);
    setError("");
    try {
      await runtime.repository.save(pending);
      setPending(null);
      setLatest(null);
      setReviewed(false);
    } catch {
      setError(
        "The operation remains pending. Retry to confirm a delivery, or compare the latest record before discarding it.",
      );
    } finally {
      setWorking(false);
    }
  };
  const review = async () => {
    setWorking(true);
    setError("");
    try {
      const records = await runtime.repository.list();
      setLatest(records.find((r) => r.id === pending?.id) ?? null);
      setReviewed(true);
    } catch {
      setError("Latest record could not be loaded. Pending work is retained.");
    } finally {
      setWorking(false);
    }
  };
  const discard = async () => {
    setWorking(true);
    try {
      await journal.purge();
      setPending(null);
      setReviewed(false);
      setLatest(null);
      setError("");
    } catch {
      setError(
        "Secure storage could not be cleared. Pending work remains blocked.",
      );
    } finally {
      setWorking(false);
    }
  };
  if (snapshot.status !== "signedIn")
    return (
      <ScrollView contentContainerStyle={styles.header}>
        <Text style={styles.eyebrow}>FIELDNOTES / LIVE</Text>
        <Text style={styles.title}>Owner sign-in</Text>
        <Text style={styles.text}>
          Continue in the system browser. Only the configured owner can
          authorize this device; sessions expire after 15 minutes.
        </Text>
        {!!snapshot.message && <Notice text={snapshot.message} />}
        {!!error && <Notice text={error} />}
        <Button
          label={
            snapshot.status === "signingIn"
              ? "Signing in…"
              : "Continue with Apple"
          }
          disabled={
            snapshot.status === "signingIn" ||
            snapshot.status === "restoring" ||
            working
          }
          onPress={() => {
            void auth.signIn();
          }}
        />
        <Button
          label="Clear local session and work"
          quiet
          disabled={working}
          onPress={() => {
            void logout();
          }}
        />
        <Button
          label="Continue with Google"
          disabled={
            snapshot.status === "signingIn" ||
            snapshot.status === "restoring" ||
            working
          }
          onPress={() => {
            void auth.signIn("google");
          }}
        />
        <Text style={styles.label}>
          Sign-in requires the selected provider to be configured for the same
          owner.
        </Text>
      </ScrollView>
    );
  if (!researchReady || researchPending)
    return (
      <ScrollView contentContainerStyle={styles.header}>
        <Text style={styles.title}>Review interrupted research request</Text>
        <Text style={styles.text}>
          Nothing is sent automatically. Retry confirms the original request.
          Refresh progress before discarding pending work.
        </Text>
        {researchPending && (
          <Text selectable style={styles.text}>
            {researchPending.action === "request"
              ? `Job ${researchPending.job} · package ${researchPending.payload.package}\n${researchPending.payload.note}`
              : `Job ${researchPending.job} · ${researchPending.action} request ${researchPending.id} · expected version ${researchPending.payload.version}`}
          </Text>
        )}
        {!!researchLatest && <Notice text={researchLatest} />}
        {!!error && <Notice text={error} />}
        <Button
          label="Retry same research operation"
          disabled={working || !researchPending}
          onPress={() => {
            if (!researchPending || !runtime.repository.researchWrite) return;
            setWorking(true);
            setError("");
            void runtime.repository
              .researchWrite(researchPending)
              .then(() => {
                setResearchPending(null);
                setResearchReviewed(false);
              })
              .catch(() =>
                setError(
                  "Research operation remains pending. Retry or refresh progress before discarding it.",
                ),
              )
              .finally(() => setWorking(false));
          }}
        />
        <Button
          label="Compare latest research progress"
          quiet
          disabled={working || !researchPending}
          onPress={() => {
            if (!researchPending || !runtime.repository.researchRequests)
              return;
            setWorking(true);
            setError("");
            void runtime.repository
              .researchRequests(researchPending.job)
              .then((rows) => {
                setResearchLatest(
                  rows
                    .filter((r) =>
                      researchPending.action === "request"
                        ? r.package === researchPending.payload.package
                        : r.id === researchPending.id,
                    )
                    .map(
                      (r) =>
                        `Request ${r.id} · package ${r.package} · current version ${r.version} · ${r.status}${r.reason ? `: ${r.reason}` : ""}`,
                    )
                    .join("\n") || "The matching research request is missing.",
                );
                setResearchReviewed(true);
              })
              .catch(() =>
                setError(
                  "Research progress could not be loaded. Pending work is retained.",
                ),
              )
              .finally(() => setWorking(false));
          }}
        />
        <Button
          label="Discard reviewed research operation"
          quiet
          disabled={working || !researchReviewed}
          onPress={() => {
            setWorking(true);
            void researchJournal
              ?.purge()
              .then(() => {
                setResearchPending(null);
                setResearchReviewed(false);
                setResearchLatest("");
                setError("");
              })
              .catch(() =>
                setError("Secure research work could not be cleared."),
              )
              .finally(() => setWorking(false));
          }}
        />
        <Button
          label="Sign out and clear local work"
          quiet
          disabled={working}
          onPress={() => void logout()}
        />
      </ScrollView>
    );
  if (pending)
    return (
      <ScrollView contentContainerStyle={styles.header}>
        <Text style={styles.title}>Review interrupted work</Text>
        <Text style={styles.text}>
          Nothing is sent automatically. Retry keeps the original body, version
          and operation key. For a conflict, compare the latest record, then
          explicitly discard this operation before editing again.
        </Text>
        <Notice
          text={`Pending ${pending.payload.kind} · version ${pending.payload.version}`}
        />
        <Text selectable style={styles.text}>
          {JSON.stringify(pending.payload.body, null, 2)}
        </Text>
        {reviewed && (
          <>
            <Text style={styles.cardTitle}>Latest server record</Text>
            <Text selectable style={styles.text}>
              {latest
                ? JSON.stringify(latest.body, null, 2)
                : "No current record"}
            </Text>
          </>
        )}
        {!!error && <Notice text={error} />}
        <Button
          label="Retry same operation"
          disabled={working}
          onPress={() => {
            void retry();
          }}
        />
        <Button
          label="Compare latest record"
          quiet
          disabled={working}
          onPress={() => {
            void review();
          }}
        />
        <Button
          label="Discard reviewed operation"
          quiet
          disabled={working || !reviewed}
          onPress={() => {
            void discard();
          }}
        />
        <Button
          label="Sign out and clear local work"
          quiet
          disabled={working}
          onPress={() => {
            void logout();
          }}
        />
      </ScrollView>
    );
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <Button
          label="Sign out and clear local work"
          quiet
          disabled={working}
          onPress={() => {
            void logout();
          }}
        />
        {!!error && <Notice text={error} />}
      </View>
      <BoardProvider key={snapshot.revision} runtime={runtime}>
        {children}
      </BoardProvider>
    </View>
  );
}

export function PrivacyShield({ children }: { children: React.ReactNode }) {
  const [covered, setCovered] = useState(AppState.currentState !== "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (value) =>
      setCovered(value !== "active"),
    );
    return () => sub.remove();
  }, []);
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
        pointerEvents={covered ? "none" : "auto"}
      >
        {children}
      </View>
      {covered && (
        <View
          testID="privacy-cover"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: colors.paper,
            zIndex: 100,
            padding: 24,
          }}
        >
          <Text style={styles.title}>Fieldnotes</Text>
          <Text style={styles.text}>Private workspace</Text>
        </View>
      )}
    </View>
  );
}
