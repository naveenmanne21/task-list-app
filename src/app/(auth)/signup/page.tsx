import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { signupAction } from "../actions";

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/tasks");

  return (
    <section className="auth-card">
      <h1>Create account</h1>
      <AuthForm action={signupAction} submitLabel="Create account" passwordAutoComplete="new-password" />
      <p>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </section>
  );
}
