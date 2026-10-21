import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getAuthSession, countUsers, SESSION_COOKIE_NAME } from "@/auth";
import ResetPasswordForm from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

/** Keep recovery public and allow authenticated replacement guidance to reach it. */
export default async function ResetPasswordPage() {
  if (countUsers() === 0) {
    redirect("/setup");
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const auth = await getAuthSession(token);
  // A fully authenticated legacy-password notice links here so its owner can
  // replace the password using the existing recovery proof without logging out.
  if (auth && !auth.session.passwordReplacementRecommended) {
    redirect("/");
  }

  return (
    <main className="auth-page">
      <ResetPasswordForm />
    </main>
  );
}
