// Applies db/migrations/*.sql in filename order, each in its own transaction,
// to the dev and test databases, connecting as the owner role.
//
//   npm run db:migrate            # dev + test databases
//   npm run db:migrate -- --test  # test database only
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { loadEnv, requireEnv } from "./env";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "db/migrations");

type Target = { label: string; ownerUrl: string; appUrl: string };

export async function migrate({ label, ownerUrl, appUrl }: Target): Promise<void> {
  const app = new URL(appUrl);
  if (decodeURIComponent(app.username) !== "app_user") {
    throw new Error(`${label}: app connection URL must use the app_user role, got "${app.username}"`);
  }
  const appUserPassword = decodeURIComponent(app.password);
  if (!appUserPassword) throw new Error(`${label}: app connection URL has no password`);

  const client = new pg.Client({ connectionString: ownerUrl });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `${label}: cannot connect to Postgres at ${redact(ownerUrl)}. Is it running? Try: npm run db:up\n  ${(err as Error).message}`,
    );
  }

  try {
    // Read by 0001 to create/alter app_user without putting a password in SQL files.
    await client.query("SELECT set_config('app.app_user_password', $1, false)", [appUserPassword]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const applied = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`${label}: migration ${file} failed: ${(err as Error).message}`);
      }
      console.log(`${label}: applied ${file}`);
      count++;
    }
    if (count === 0) console.log(`${label}: up to date`);
  } finally {
    await client.end();
  }
}

function redact(url: string): string {
  const u = new URL(url);
  if (u.password) u.password = "***";
  return u.toString();
}

async function main() {
  loadEnv();
  const testOnly = process.argv.includes("--test");
  const targets: Target[] = [];
  if (!testOnly) {
    targets.push({
      label: "dev",
      ownerUrl: requireEnv("MIGRATION_DATABASE_URL"),
      appUrl: requireEnv("DATABASE_URL"),
    });
  }
  targets.push({
    label: "test",
    ownerUrl: requireEnv("TEST_MIGRATION_DATABASE_URL"),
    appUrl: requireEnv("TEST_DATABASE_URL"),
  });
  for (const t of targets) await migrate(t);
}

// Run when invoked directly (also importable from test setup).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
