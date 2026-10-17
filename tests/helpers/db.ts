// Owner (superuser) connection for test setup and inspection ONLY.
// Assertions about what the app can see or do must go through app_user
// (withUser / the app pool), never through this.
import pg from "pg";
import { loadEnv, requireEnv } from "../../scripts/env";

loadEnv();

pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const ownerPool = new pg.Pool({ connectionString: requireEnv("TEST_MIGRATION_DATABASE_URL"), max: 2 });

export async function resetDb(): Promise<void> {
  await ownerPool.query("TRUNCATE tasks, sessions, users RESTART IDENTITY CASCADE");
}

export async function createUser(email: string): Promise<string> {
  const { rows } = await ownerPool.query<{ id: string }>(
    "INSERT INTO users (email, password_hash) VALUES ($1, 'not-a-real-hash') RETURNING id",
    [email],
  );
  return rows[0].id;
}
