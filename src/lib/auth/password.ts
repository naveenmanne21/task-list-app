import bcrypt from "bcryptjs";

const ROUNDS = 12;

// bcrypt only uses the first 72 bytes and bcryptjs truncates silently, so the
// signup schema rejects longer passwords instead.
export const MAX_PASSWORD_BYTES = 72;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Compared against when the email is unknown, so a login for a non-existent
// account takes as long as one with a wrong password.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash("dummy-password-for-timing", ROUNDS);
  return dummyHash;
}
