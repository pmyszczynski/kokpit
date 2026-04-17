import { redirect } from "next/navigation";
import { countUsers } from "@/auth";
import SetupForm from "./SetupForm";

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  if (countUsers() > 0) {
    redirect("/login");
  }

  return (
    <main
      style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}
    >
      <SetupForm />
    </main>
  );
}
