"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, deleteSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { logIn, signUp, type AuthResult, type FieldErrors } from "@/lib/auth/service";

export type AuthFormState = { error?: string; fieldErrors?: FieldErrors; email?: string };

async function startSession(userId: string) {
  const { token, expiresAt } = await createSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

async function handle(
  run: (input: { email: unknown; password: unknown }) => Promise<AuthResult>,
  formData: FormData,
): Promise<AuthFormState> {
  const email = formData.get("email");
  const result = await run({ email, password: formData.get("password") });
  if (!result.ok) {
    return { error: result.error, fieldErrors: result.fieldErrors, email: typeof email === "string" ? email : "" };
  }
  await startSession(result.userId);
  redirect("/tasks"); // throws; must stay outside any try/catch
}

export async function signupAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return handle(signUp, formData);
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return handle(logIn, formData);
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
