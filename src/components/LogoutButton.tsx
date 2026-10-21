"use client";

import { useConfigurationSync } from "./ConfigurationSyncProvider";
import { useRouter } from "next/navigation";
import { useUnsavedChanges } from "./unsaved/UnsavedChangesProvider";

export default function LogoutButton() {
  const router = useRouter();
  const revoke = useConfigurationSync()?.revoke;
  const unsaved = useUnsavedChanges();

  async function handleLogout() {
    if (unsaved && !(await unsaved.confirm({ deferDiscard: true }))) return;
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", headers: { "X-Kokpit-Request": "1" } });
      if (!res.ok) throw new Error("Logout failed");
      if (revoke) { revoke(); return; }
      unsaved?.clear();
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
