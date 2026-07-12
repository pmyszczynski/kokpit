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
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "320px" }}>
        <h1>Password reset</h1>
        <p style={{ margin: 0, opacity: 0.7 }}>
          {result.totpStillEnabled
            ? "Your password has been changed. Your authenticator app is still required to sign in."
            : "Your password has been changed."}
        </p>
        <p style={{ margin: 0, opacity: 0.7 }}>
          Your recovery code has been used and is no longer valid. Generate a
          new one from Settings → Authentication once you&apos;re signed in.
        </p>
        <Link href="/login">Continue to login →</Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "320px" }}
    >
      <h1>Reset your password</h1>
      <p style={{ margin: 0, opacity: 0.7 }}>
        Enter the recovery code you saved when you set up Kokpit. This resets
        your password only — if you have 2FA enabled, you&apos;ll still need
        your authenticator app to sign in.
      </p>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <input name="username" type="text" placeholder="Username" required autoComplete="username" />
      <input
        name="recoveryCode"
        type="text"
        placeholder="Recovery code"
        required
        autoComplete="off"
      />
      <input
        name="newPassword"
        type="password"
        placeholder="New password (min 8 chars)"
        required
        autoComplete="new-password"
        minLength={8}
      />
      <input
        name="confirm"
        type="password"
        placeholder="Confirm new password"
        required
        autoComplete="new-password"
      />
      <button type="submit" disabled={loading}>
        {loading ? "Resetting…" : "Reset password"}
      </button>
      <Link href="/login" style={{ opacity: 0.6 }}>
        ← Back to login
      </Link>
    </form>
  );
}
