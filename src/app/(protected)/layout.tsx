import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getAuthUser, countUsers, SESSION_COOKIE_NAME } from "@/auth";
import { getConfig } from "@/config";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const config = getConfig();
  const authEnabled =
    config.auth.enabled && process.env.KOKPIT_AUTH_DISABLED !== "true";

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
  }

  return <>{children}</>;
}
