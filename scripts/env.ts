// Env loading for code that runs outside Next.js (scripts, vitest).
// Next.js loads .env itself; tsx and vitest do not.
import { existsSync } from "node:fs";
import path from "node:path";

export function loadEnv(): void {
  const file = path.resolve(process.cwd(), ".env");
  if (!existsSync(file)) {
    throw new Error(`Missing ${file}. Create it with: cp .env.example .env`);
  }
  // Built into Node >= 20.12. Does not override variables already set in the shell.
  process.loadEnvFile(file);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} is not set (see .env.example)`);
  return value;
}
