import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getAuthSession, countUsers, SESSION_COOKIE_NAME } from "@/auth";
import { getConfigSnapshot, getPublishedConfigSnapshot } from "@/config/server";
import { configRevision } from "@/config/revision";
import { resolveAppearance } from "@/config/theme";
import { pollingRevision } from "@/config/pollingRevision";
import { ConfigurationSyncProvider } from "@/components/ConfigurationSyncProvider";
import Navbar from "@/components/Navbar";
import { EditModeProvider } from "@/components/edit/EditModeProvider";
import SessionRenewal from "@/components/SessionRenewal";
import PasswordReplacementNotice from "@/components/PasswordReplacementNotice";
import { UnsavedChangesProvider } from "@/components/unsaved/UnsavedChangesProvider";

export const dynamic = 'force-dynamic';

/** Authorize the shell before rendering session-specific account guidance. */
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let snapshot: ReturnType<typeof getConfigSnapshot>;
  try { snapshot = getConfigSnapshot(); }
  catch { snapshot = getPublishedConfigSnapshot(); }
  function recoverySurface() {
    return <div className="shell"><UnsavedChangesProvider>
      <ConfigurationSyncProvider initialRevision={null} initialEditable={false} initialAppearance={null} initialDataRevision={null}>
        {null}
      </ConfigurationSyncProvider>
    </UnsavedChangesProvider></div>;
  }
  // Do not render a previously public dashboard while an external editor has
  // left the authorization configuration incomplete.
  if ((snapshot.state !== "ready" && snapshot.state !== "migration-required") || !snapshot.config || !snapshot.source) {
    return recoverySurface();
  }
  const config = snapshot.config;
  const authEnabled =
    config.auth.enabled && process.env.KOKPIT_AUTH_DISABLED !== "true";

  let showLogout = false;
  let passwordReplacementRecommended = false;

  if (authEnabled) {
    if (countUsers() === 0) {
      redirect("/setup");
    }

    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const auth = await getAuthSession(token);

    if (!auth) {
      redirect("/login");
    }

    showLogout = true;
    passwordReplacementRecommended = auth.session.passwordReplacementRecommended === true;
  }

  const confirmed = getPublishedConfigSnapshot();
  if (confirmed.state !== snapshot.state || confirmed.source !== snapshot.source || confirmed.config !== snapshot.config) return recoverySurface();

  // Reaching this render means the viewer is allowed (unauthed users are
  // redirected above), so editing is permitted — mirrors the /api/settings
  // guard intent without a second round-trip.
  const canEdit = !authEnabled || showLogout;

  return (
    <div className="shell">
      <UnsavedChangesProvider>
        <ConfigurationSyncProvider
          initialRevision={configRevision(snapshot.source)}
          initialEditable={snapshot.state === "ready"}
          initialAppearance={resolveAppearance(config)}
          initialDataRevision={pollingRevision(config)}
        >
          <EditModeProvider
            canEdit={canEdit}
            connectionTestingEnabled={authEnabled}
          >
            <Navbar showLogout={showLogout} canEdit={canEdit} />
            {showLogout && <SessionRenewal />}
            <main className="shell-main">
              {passwordReplacementRecommended && <PasswordReplacementNotice />}
              {children}
            </main>
          </EditModeProvider>
        </ConfigurationSyncProvider>
      </UnsavedChangesProvider>
    </div>
  );
}
