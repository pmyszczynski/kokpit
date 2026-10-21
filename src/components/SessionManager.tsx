"use client";

import { useEffect, useState } from "react";
import { useConfigurationSync } from "./ConfigurationSyncProvider";
import { useRouter } from "next/navigation";
import { useUnsavedChanges, useUnsavedSource } from "./unsaved/UnsavedChangesProvider";

type Session = {
  id: string;
  device: string;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
};

type PendingAction =
  | { action: "revoke"; session: Session }
  | { action: "revoke-others" }
  | { action: "revoke-all" };

function formatDate(time: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(time);
}

export default function SessionManager() {
  const router = useRouter();
  const revoke = useConfigurationSync()?.revoke;
  const unsaved = useUnsavedChanges();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useUnsavedSource("session-manager", {
    label: "Signed-in device confirmation", dirty: Boolean(password), saving: submitting,
    version: password, discard: () => { setPassword(""); setPendingAction(null); },
  });

  async function loadSessions() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/sessions");
      if (!response.ok) throw new Error();
      const body = await response.json() as { sessions?: Session[] };
      setSessions(body.sessions ?? []);
    } catch {
      setError("Could not load signed-in devices.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSessions(); }, []);

  function actionLabel(action: PendingAction) {
    if (action.action === "revoke") return action.session.current ? "Sign out this device" : "Sign out device";
    return action.action === "revoke-others" ? "Sign out all other devices" : "Sign out all devices";
  }

  function needsPassword(action: PendingAction) {
    return action.action !== "revoke" || !action.session.current;
  }

  function chooseAction(action: PendingAction) {
    setPassword("");
    setPendingAction(action);
  }

  async function submit() {
    if (!pendingAction || submitting || (needsPassword(pendingAction) && !password)) return;
    const action = pendingAction;
    if ((action.action === "revoke-all" || (action.action === "revoke" && action.session.current))
      && unsaved && !(await unsaved.confirm({ excludeIds: ["session-manager"], deferDiscard: true }))) return;
    setSubmitting(true);
    setError(null);
    const finishWrite = unsaved?.beginWrite();
    const body = action.action === "revoke"
      ? { action: "revoke", sessionId: action.session.id, ...(needsPassword(action) ? { password } : {}) }
      : { action: action.action, password };
    try {
      const response = await fetch("/api/auth/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kokpit-Request": "1" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => ({})) as { error?: string };
        setError(json.error ?? "Could not update signed-in devices.");
        return;
      }
      setPassword("");
      setPendingAction(null);
      if (action.action === "revoke-all" || (action.action === "revoke" && action.session.current)) {
        if (revoke) { revoke(); return; }
        unsaved?.clear();
        router.push("/login");
        router.refresh();
      } else {
        await loadSessions();
      }
    } catch {
      setError("Could not update signed-in devices.");
    } finally {
      setSubmitting(false);
      finishWrite?.();
    }
  }

  return (
    <section className="settings-form-row settings-form-row--column" aria-labelledby="signed-in-devices-title">
      <h3 id="signed-in-devices-title" className="settings-section__subtitle">Signed-in devices</h3>
      <p className="settings-hint">Review and revoke access from browsers signed in to your account.</p>
      {loading && <p className="settings-hint">Loading devices…</p>}
      {error && <p className="settings-hint" role="alert">{error}</p>}
      {!loading && sessions.map((session) => (
        <div className="settings-form-row settings-form-row--column" key={session.id}>
          <p style={{ margin: 0 }}>
            <strong>{session.device}</strong>{session.current && " (This device)"}
          </p>
          <p className="settings-hint">Signed in {formatDate(session.createdAt)} · Last active {formatDate(session.lastSeenAt)}</p>
          <button className="settings-btn settings-btn--danger" onClick={() => chooseAction({ action: "revoke", session })} disabled={submitting}>
            {session.current ? "Sign out this device" : "Sign out device"}
          </button>
        </div>
      ))}
      {!loading && sessions.length === 0 && <p className="settings-hint">No active sessions found.</p>}
      <div className="settings-form-row flex-wrap">
        <button className="settings-btn settings-btn--danger" onClick={() => chooseAction({ action: "revoke-others" })} disabled={submitting || sessions.filter((session) => !session.current).length === 0}>
          Sign out all other devices
        </button>
        <button className="settings-btn settings-btn--danger" onClick={() => chooseAction({ action: "revoke-all" })} disabled={submitting || sessions.length === 0}>
          Sign out all devices
        </button>
      </div>
      {pendingAction && (
        <div className="settings-form-row settings-form-row--column">
          <p className="settings-hint">{actionLabel(pendingAction)}?</p>
          {needsPassword(pendingAction) && (
            <div className="settings-form-row flex-wrap">
              <label htmlFor="session-manager-password">Current password</label>
              <input id="session-manager-password" type="password" value={password} disabled={submitting} onChange={(event) => { if (!submitting) setPassword(event.target.value); }} className="settings-input" autoComplete="current-password" />
            </div>
          )}
          <div className="settings-form-row flex-wrap">
            <button className="settings-save-btn" onClick={submit} disabled={submitting || (needsPassword(pendingAction) && !password)}>
              {submitting ? "Signing out…" : "Confirm"}
            </button>
            <button className="settings-btn" onClick={() => { setPendingAction(null); setPassword(""); }} disabled={submitting}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
