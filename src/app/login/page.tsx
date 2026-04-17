import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getAuthUser, countUsers, SESSION_COOKIE_NAME } from "@/auth";
import LoginForm from "./LoginForm";

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (countUsers() === 0) {
    redirect("/setup");
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = await getAuthUser(token);
  if (user) {
    redirect("/");
  }

  return (
    <main
      style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}
    >
      <LoginForm />
    </main>
  );
}
