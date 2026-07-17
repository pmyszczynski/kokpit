"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
    try {
      const data = new FormData(e.currentTarget);
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: data.get("username"),
          password: data.get("password"),
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.requiresTotp) {
          if (!json.challengeToken) {
            setError("Login failed: missing challenge token");
            return;
          }
          setChallengeToken(json.challengeToken);
          setStep("totp");
        } else {
          router.push("/");
          router.refresh();
        }
      } else {
        const json = await res.json().catch(() => ({}));
        setError((json as { error?: string }).error ?? "Login failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleTotpSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!challengeToken) {
      setError("Session error, please log in again");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const data = new FormData(e.currentTarget);
      const res = await fetch("/api/auth/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken,
          code: data.get("code"),
        }),
      });

      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        const json = await res.json().catch(() => ({}));
        setError((json as { error?: string }).error ?? "Invalid code");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  if (step === "totp") {
    return (
      <div className="auth-card">
        <div>
          <div className="auth-card__badge">K</div>
          <h1 className="auth-card__title">Two-Factor Authentication</h1>
          <p className="auth-card__subtitle">Enter the 6-digit code from your authenticator app.</p>
        </div>
        <form onSubmit={handleTotpSubmit} className="auth-form">
          {error && <p className="auth-error" role="alert">{error}</p>}
          <div className="auth-field">
            <label htmlFor="totp-code">Authenticator code</label>
            <input
              id="totp-code"
              name="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              required
              autoComplete="one-time-code"
              autoFocus
              className="auth-otp-input"
            />
          </div>
          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading ? "Verifying…" : "Verify"}
          </button>
          <button
            type="button"
            className="auth-back-btn"
            onClick={() => { setStep("credentials"); setChallengeToken(null); setError(null); }}
          >
            ← Back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <div>
        <div className="auth-card__badge">K</div>
        <h1 className="auth-card__title">Sign in to Kokpit</h1>
        <p className="auth-card__subtitle">Enter your credentials to access your dashboard.</p>
      </div>
      <form onSubmit={handleCredentialsSubmit} className="auth-form">
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="auth-field">
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            name="username"
            type="text"
            placeholder="Username"
            required
            autoComplete="username"
            autoFocus
          />
        </div>
        <div className="auth-field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            placeholder="Password"
            required
            autoComplete="current-password"
          />
        </div>
        <button type="submit" className="auth-submit-btn" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <Link href="/reset-password" className="auth-back-btn">
          Forgot password?
        </Link>
      </form>
    </div>
  );
}
