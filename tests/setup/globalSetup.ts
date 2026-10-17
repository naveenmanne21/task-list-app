// Runs once before the test run: checks the test database is reachable and
// migrates it. Fails loudly (never skips) if Postgres isn't available.
import pg from "pg";
import { loadEnv, requireEnv } from "../../scripts/env";
import { migrate } from "../../scripts/migrate";

const HINT = "Start it with: npm run db:up && npm run db:migrate";

export default async function setup() {
  loadEnv();
  const ownerUrl = requireEnv("TEST_MIGRATION_DATABASE_URL");
  const appUrl = requireEnv("TEST_DATABASE_URL");

  // Tests truncate tables, so refuse to point them at anything but a *_test DB.
  for (const url of [ownerUrl, appUrl]) {
    const db = new URL(url).pathname.slice(1);
    if (!db.endsWith("_test")) {
      throw new Error(`Refusing to run tests against database "${db}": test URLs must point at a *_test database.`);
    }
  }

  await assertReachable(ownerUrl, "owner");
  await migrate({ label: "test", ownerUrl, appUrl });
  await assertReachable(appUrl, "app_user");
}

async function assertReachable(url: string, who: string) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } catch (err) {
    const { hostname, port, pathname } = new URL(url);
    // ECONNREFUSED arrives as an AggregateError with an empty message; use its code.
    const e = err as Error & { code?: string };
    const reason = e.message || e.code || String(err);
    throw new Error(
      `\n\nTests need Postgres, but connecting as ${who} to ${hostname}:${port}${pathname} failed: ${reason}\n${HINT}\n`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}
