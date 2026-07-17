"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const data = new FormData(e.currentTarget);
    const password = data.get("password") as string;
    const confirm = data.get("confirm") as string;

    if (password !== confirm) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: data.get("username"), password }),
    });

    setLoading(false);

    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      const code = (json as { recoveryCode?: unknown }).recoveryCode;
      if (typeof code === "string" && code) {
        setRecoveryCode(code);
      } else {
        setError(
          "Account created, but the recovery code couldn't be read. Log in, then generate a new one from Settings → Authentication."
        );
      }
    } else {
      const json = await res.json().catch(() => ({}));
      setError((json as { error?: string }).error ?? "Setup failed");
    }
  }

  if (recoveryCode) {
    return (
      <div className="auth-card">
        <div>
          <div className="auth-card__badge">K</div>
          <h1 className="auth-card__title">Save your recovery code</h1>
          <p className="auth-card__subtitle">
            Kokpit doesn&apos;t store an email address, so this code is the only way to
            reset your password if you forget it. Save it somewhere safe (a password
            manager) — it will not be shown again.
          </p>
        </div>
        <div className="auth-form">
          <code
            style={{
              userSelect: "all",
              padding: "0.75rem",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              textAlign: "center",
              letterSpacing: "0.05em",
              wordBreak: "break-all",
            }}
          >
            {recoveryCode}
          </code>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
            />
            I&apos;ve saved this code
          </label>
          <button
            type="button"
            className="auth-submit-btn"
            disabled={!saved}
            onClick={() => router.push("/login")}
          >
            Continue to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <div>
        <div className="auth-card__badge">K</div>
        <h1 className="auth-card__title">Welcome to Kokpit</h1>
        <p className="auth-card__subtitle">Create your admin account to get started.</p>
      </div>
      <form onSubmit={handleSubmit} className="auth-form">
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="auth-field">
          <label htmlFor="setup-username">Username</label>
          <input
            id="setup-username"
            name="username"
            type="text"
            placeholder="Username"
            required
            autoComplete="username"
            autoFocus
          />
        </div>
        <div className="auth-field">
          <label htmlFor="setup-password">Password</label>
          <input
            id="setup-password"
            name="password"
            type="password"
            placeholder="Password (min 8 chars)"
            required
            autoComplete="new-password"
            minLength={8}
          />
        </div>
        <div className="auth-field">
          <label htmlFor="setup-confirm">Confirm password</label>
          <input
            id="setup-confirm"
            name="confirm"
            type="password"
            placeholder="Confirm password"
            required
            autoComplete="new-password"
          />
        </div>
        <button type="submit" className="auth-submit-btn" disabled={loading}>
          {loading ? "Creating account…" : "Create admin account"}
        </button>
      </form>
    </div>
  );
}
