import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getAuthSession, countUsers, SESSION_COOKIE_NAME } from "@/auth";
import { getConfigSnapshot } from "@/config/server";
import Navbar from "@/components/Navbar";
import { EditModeProvider } from "@/components/edit/EditModeProvider";
import SessionRenewal from "@/components/SessionRenewal";
import PasswordReplacementNotice from "@/components/PasswordReplacementNotice";

export const dynamic = 'force-dynamic';

/** Authorize the shell before rendering session-specific account guidance. */
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const snapshot = getConfigSnapshot();
  // Do not render a previously public dashboard while an external editor has
  // left the authorization configuration incomplete.
  if (snapshot.state === "dirty" && process.env.KOKPIT_AUTH_DISABLED !== "true") {
    redirect("/login");
  }
  const config = snapshot.config;
  if (!config) redirect("/login");
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

  // Reaching this render means the viewer is allowed (unauthed users are
  // redirected above), so editing is permitted — mirrors the /api/settings
  // guard intent without a second round-trip.
  const canEdit = !authEnabled || showLogout;

  return (
    <div className="shell">
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
    </div>
  );
}
