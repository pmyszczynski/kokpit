"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      router.push("/login");
    } else {
      const json = await res.json();
      setError(json.error ?? "Setup failed");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "320px" }}
    >
      <h1>Welcome to Kokpit</h1>
      <p>Create your admin account to get started.</p>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <input name="username" type="text" placeholder="Username" required autoComplete="username" />
      <input
        name="password"
        type="password"
        placeholder="Password (min 8 chars)"
        required
        autoComplete="new-password"
        minLength={8}
      />
      <input
        name="confirm"
        type="password"
        placeholder="Confirm password"
        required
        autoComplete="new-password"
      />
      <button type="submit" disabled={loading}>
        {loading ? "Creating account…" : "Create admin account"}
      </button>
    </form>
  );
}
