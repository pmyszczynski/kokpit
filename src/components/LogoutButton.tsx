"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", headers: { "X-Kokpit-Request": "1" } });
      if (!res.ok) throw new Error("Logout failed");
      router.push("/login");
      router.refresh();
    } catch {
      alert("Sign out failed. Please try again.");
    }
  }

  return (
    <button className="logout-btn" onClick={handleLogout}>
      Sign out
    </button>
  );
}
