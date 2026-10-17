// Signup / login logic, independent of Next.js so it can be tested directly.
// The Server Actions in src/app/(auth)/actions.ts add the session cookie.
import { z } from "zod";
import { pool } from "@/lib/db/pool";
import { getDummyHash, hashPassword, MAX_PASSWORD_BYTES, verifyPassword } from "./password";

export const INVALID_CREDENTIALS = "Invalid email or password.";
export const EMAIL_TAKEN = "An account with this email already exists.";

const email = z.string().trim().toLowerCase().max(320, "Email is too long.").pipe(z.email("Enter a valid email."));

export const signupSchema = z.object({
  email,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .refine((p) => Buffer.byteLength(p, "utf8") <= MAX_PASSWORD_BYTES, "Password must be at most 72 bytes."),
});

// Login doesn't re-check the password policy; anything wrong is just "invalid".
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "Enter your email."),
  password: z.string().min(1, "Enter your password.").max(1000),
});

export type FieldErrors = Partial<Record<"email" | "password", string>>;

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; error?: string; fieldErrors?: FieldErrors };

function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if ((key === "email" || key === "password") && !out[key]) out[key] = issue.message;
  }
  return out;
}

export async function signUp(input: unknown): Promise<AuthResult> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
      [parsed.data.email, passwordHash],
    );
    return { ok: true, userId: rows[0].id };
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return { ok: false, fieldErrors: { email: EMAIL_TAKEN } };
    throw err;
  }
}

export async function logIn(input: unknown): Promise<AuthResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const { rows } = await pool.query<{ id: string; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE lower(email) = $1",
    [parsed.data.email],
  );
  const user = rows[0];
  // Always run bcrypt so unknown emails aren't distinguishable by timing.
  const valid = await verifyPassword(parsed.data.password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !valid) return { ok: false, error: INVALID_CREDENTIALS };
  return { ok: true, userId: user.id };
}
