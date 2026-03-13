"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"credentials" | "totp">("credentials");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  async function handleCredentialsSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const data = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: data.get("username"),
        password: data.get("password"),
      }),
    });

    setLoading(false);

    if (res.ok) {
      const json = await res.json();
      if (json.requiresTotp) {
        setChallengeToken(json.challengeToken);
        setStep("totp");
      } else {
        router.push("/");
        router.refresh();
      }
    } else {
      const json = await res.json();
      setError(json.error ?? "Login failed");
    }
  }

  async function handleTotpSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const data = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/totp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeToken,
        code: data.get("code"),
      }),
    });

    setLoading(false);

    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const json = await res.json();
      setError(json.error ?? "Invalid code");
    }
  }

  if (step === "totp") {
    return (
      <form
        onSubmit={handleTotpSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "320px" }}
      >
        <h1>Two-Factor Authentication</h1>
        <p style={{ margin: 0, opacity: 0.7 }}>Enter the 6-digit code from your authenticator app.</p>
        {error && <p style={{ color: "red" }}>{error}</p>}
        <input
          name="code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="000000"
          required
          autoComplete="one-time-code"
          autoFocus
        />
        <button type="submit" disabled={loading}>
          {loading ? "Verifying…" : "Verify"}
        </button>
        <button
          type="button"
          onClick={() => { setStep("credentials"); setChallengeToken(null); setError(null); }}
          style={{ background: "none", border: "none", cursor: "pointer", opacity: 0.6, padding: 0 }}
        >
          ← Back
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={handleCredentialsSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "320px" }}
    >
      <h1>Sign in to Kokpit</h1>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <input
        name="username"
        type="text"
        placeholder="Username"
        required
        autoComplete="username"
      />
      <input
        name="password"
        type="password"
        placeholder="Password"
        required
        autoComplete="current-password"
      />
      <button type="submit" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
