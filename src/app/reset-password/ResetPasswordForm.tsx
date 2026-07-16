"use client";

import { useState } from "react";
import Link from "next/link";

export default function ResetPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ totpStillEnabled: boolean } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const data = new FormData(e.currentTarget);
    const newPassword = data.get("newPassword") as string;
    const confirm = data.get("confirm") as string;

    if (newPassword !== confirm) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: data.get("username"),
          recoveryCode: data.get("recoveryCode"),
          newPassword,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (res.ok) {
        setResult({ totpStillEnabled: !!json.totpStillEnabled });
      } else {
        setError((json as { error?: string }).error ?? "Reset failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="auth-card">
        <div>
          <div className="auth-card__badge">K</div>
          <h1 className="auth-card__title">Password reset</h1>
          <p className="auth-card__subtitle">
            {result.totpStillEnabled
              ? "Your password has been changed. Your authenticator app is still required to sign in."
              : "Your password has been changed."}
          </p>
        </div>
        <p className="auth-card__subtitle" style={{ marginTop: 0 }}>
          Your recovery code has been used and is no longer valid. Generate a
          new one from Settings → Authentication once you&apos;re signed in.
        </p>
        <Link href="/login" className="auth-back-btn">
          Continue to login →
        </Link>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <div>
        <div className="auth-card__badge">K</div>
        <h1 className="auth-card__title">Reset your password</h1>
        <p className="auth-card__subtitle">
          Enter the recovery code you saved when you set up Kokpit. This resets
          your password only — if you have 2FA enabled, you&apos;ll still need
          your authenticator app to sign in.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="auth-form">
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="auth-field">
          <label htmlFor="reset-username">Username</label>
          <input
            id="reset-username"
            name="username"
            type="text"
            placeholder="Username"
            required
            autoComplete="username"
            autoFocus
          />
        </div>
        <div className="auth-field">
          <label htmlFor="reset-recovery-code">Recovery code</label>
          <input
            id="reset-recovery-code"
            name="recoveryCode"
            type="text"
            placeholder="Recovery code"
            required
            autoComplete="off"
          />
        </div>
        <div className="auth-field">
          <label htmlFor="reset-new-password">New password</label>
          <input
            id="reset-new-password"
            name="newPassword"
            type="password"
            placeholder="New password (min 8 chars)"
            required
            autoComplete="new-password"
            minLength={8}
          />
        </div>
        <div className="auth-field">
          <label htmlFor="reset-confirm">Confirm new password</label>
          <input
            id="reset-confirm"
            name="confirm"
            type="password"
            placeholder="Confirm new password"
            required
            autoComplete="new-password"
          />
        </div>
        <button type="submit" className="auth-submit-btn" disabled={loading}>
          {loading ? "Resetting…" : "Reset password"}
        </button>
        <Link href="/login" className="auth-back-btn">
          ← Back to login
        </Link>
      </form>
    </div>
  );
}
