// Signup / login logic and sessions against the test database. The Server
// Actions are thin wrappers (cookie + redirect) around these functions.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/pool";
import { EMAIL_TAKEN, INVALID_CREDENTIALS, logIn, signUp } from "@/lib/auth/service";
import { createSession, deleteSession, getSessionUser, hashToken } from "@/lib/auth/session";
import { ownerPool, resetDb } from "../helpers/db";

const PASSWORD = "correct horse battery";

beforeEach(resetDb);

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
});

describe("signUp", () => {
  it("creates a user with a normalised email and a bcrypt hash, not the password", async () => {
    const result = await signUp({ email: "  Carol@Example.COM ", password: PASSWORD });
    expect(result).toMatchObject({ ok: true });

    const { rows } = await ownerPool.query("SELECT id, email, password_hash FROM users");
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("carol@example.com");
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(rows[0].password_hash).not.toContain(PASSWORD);
    if (result.ok) expect(result.userId).toBe(rows[0].id);
  });

  it("rejects an email that is already registered, ignoring case", async () => {
    await signUp({ email: "carol@example.com", password: PASSWORD });
    expect(await signUp({ email: "CAROL@example.com", password: PASSWORD })).toEqual({
      ok: false,
      fieldErrors: { email: EMAIL_TAKEN },
    });
  });

  it("validates the email and password", async () => {
    const result = await signUp({ email: "not-an-email", password: "short" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors?.email).toBeDefined();
      expect(result.fieldErrors?.password).toMatch(/at least 8/);
    }
  });

  it("rejects passwords over 72 bytes (bcrypt would silently ignore the rest)", async () => {
    const result = await signUp({ email: "carol@example.com", password: "é".repeat(37) }); // 74 bytes
    expect(result).toMatchObject({ ok: false, fieldErrors: { password: expect.stringMatching(/72 bytes/) } });
  });

  it("rejects non-string input", async () => {
    expect((await signUp({ email: null, password: 123 })).ok).toBe(false);
  });
});

describe("logIn", () => {
  let userId: string;

  beforeEach(async () => {
    const result = await signUp({ email: "dave@example.com", password: PASSWORD });
    if (!result.ok) throw new Error("setup failed");
    userId = result.userId;
  });

  it("logs in with the right password, ignoring email case and spaces", async () => {
    expect(await logIn({ email: " Dave@Example.com", password: PASSWORD })).toEqual({ ok: true, userId });
  });

  it("rejects a wrong password", async () => {
    expect(await logIn({ email: "dave@example.com", password: "wrong password" })).toEqual({
      ok: false,
      error: INVALID_CREDENTIALS,
    });
  });

  it("gives an unknown email exactly the same result as a wrong password", async () => {
    const wrongPassword = await logIn({ email: "dave@example.com", password: "wrong password" });
    const unknownEmail = await logIn({ email: "nobody@example.com", password: PASSWORD });
    expect(unknownEmail).toEqual(wrongPassword);
  });
});

describe("sessions", () => {
  let userId: string;

  beforeEach(async () => {
    const result = await signUp({ email: "erin@example.com", password: PASSWORD });
    if (!result.ok) throw new Error("setup failed");
    userId = result.userId;
  });

  it("stores only the SHA-256 hash of the token", async () => {
    const { token } = await createSession(userId);
    const { rows } = await ownerPool.query("SELECT id FROM sessions");
    expect(rows).toEqual([{ id: hashToken(token) }]);
    expect(rows[0].id).not.toBe(token);
    expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("expires after 7 days", async () => {
    const { expiresAt } = await createSession(userId);
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });

  it("resolves a valid token to its user", async () => {
    const { token } = await createSession(userId);
    expect(await getSessionUser(token)).toEqual({ id: userId, email: "erin@example.com" });
  });

  it("rejects an expired session", async () => {
    const { token } = await createSession(userId);
    await ownerPool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    expect(await getSessionUser(token)).toBeNull();
  });

  it("rejects an unknown token, and the stored hash used as a token", async () => {
    const { token } = await createSession(userId);
    expect(await getSessionUser("not-a-real-token")).toBeNull();
    expect(await getSessionUser(hashToken(token))).toBeNull();
  });

  it("logout deletes the session", async () => {
    const { token } = await createSession(userId);
    await deleteSession(token);
    expect(await getSessionUser(token)).toBeNull();
  });
});
