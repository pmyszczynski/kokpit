import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getAuthUser, countUsers, SESSION_COOKIE_NAME } from "@/auth";
import { getConfig } from "@/config";
import Navbar from "@/components/Navbar";
import { EditModeProvider } from "@/components/edit/EditModeProvider";

export const dynamic = 'force-dynamic';

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const config = getConfig();
  const authEnabled =
    config.auth.enabled && process.env.KOKPIT_AUTH_DISABLED !== "true";

  let showLogout = false;

  if (authEnabled) {
    if (countUsers() === 0) {
      redirect("/setup");
    }

    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const user = await getAuthUser(token);

    if (!user) {
      redirect("/login");
    }

    showLogout = true;
  }

  // Reaching this render means the viewer is allowed (unauthed users are
  // redirected above), so editing is permitted — mirrors the /api/settings
  // guard intent without a second round-trip.
  const canEdit = !authEnabled || showLogout;

  return (
    <div className="shell">
      <Navbar showLogout={showLogout} canEdit={canEdit} />
      <EditModeProvider canEdit={canEdit}>
        <main className="shell-main">{children}</main>
      </EditModeProvider>
    </div>
  );
}
