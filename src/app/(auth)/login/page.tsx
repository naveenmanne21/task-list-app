import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { loginAction } from "../actions";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/tasks");

  return (
    <section className="auth-card">
      <h1>Sign in</h1>
      <AuthForm action={loginAction} submitLabel="Sign in" passwordAutoComplete="current-password" />
      <p>
        No account? <Link href="/signup">Create one</Link>
      </p>
    </section>
  );
}
