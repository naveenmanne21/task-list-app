// Creates the demo users (DEMO ONLY — these credentials are public in the README).
// Safe to re-run: existing demo users get their password reset.
//
//   npm run db:seed
import pg from "pg";
import { hashPassword } from "../src/lib/auth/password.ts";
import { loadEnv, requireEnv } from "./env.ts";

const DEMO_USERS = [
  { email: "alice@example.com", password: "alice-demo-pass" },
  { email: "bob@example.com", password: "bob-demo-pass" },
];

async function main() {
  loadEnv();
  // Owner connection: setup script, and the upsert needs UPDATE on users,
  // which app_user deliberately doesn't have.
  const client = new pg.Client({ connectionString: requireEnv("MIGRATION_DATABASE_URL") });
  await client.connect().catch((err: Error & { code?: string }) => {
    throw new Error(`Cannot connect to Postgres (${err.message || err.code}). Try: npm run db:up && npm run db:migrate`);
  });
  try {
    for (const { email, password } of DEMO_USERS) {
      await client.query(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2)
         ON CONFLICT ((lower(email))) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [email, await hashPassword(password)],
      );
      console.log(`seeded ${email} / ${password}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
