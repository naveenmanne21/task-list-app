import { createHash, randomBytes } from "node:crypto";
import { pool } from "@/lib/db/pool";
import { SESSION_COOKIE } from "./session-cookie";

// users and sessions are not under RLS (login happens before there is a current
// user), so these queries use the pool directly rather than withUser.

export { SESSION_COOKIE };
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionUser = { id: string; email: string };

/** Only this hash is stored; the raw token lives in the user's cookie. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)", [
    hashToken(token),
    userId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

/** The session's user, or null if the token is unknown or expired. */
export async function getSessionUser(token: string): Promise<SessionUser | null> {
  const { rows } = await pool.query<SessionUser>(
    `SELECT u.id, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE id = $1", [hashToken(token)]);
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}
