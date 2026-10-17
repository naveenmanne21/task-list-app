import pg from "pg";

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates, which would
// shift by the server's timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

// Connects as app_user (DATABASE_URL), so RLS always applies. Cached on
// globalThis so Next.js dev hot-reloads don't open a new pool on every edit.
const globalForPg = globalThis as unknown as { pgPool?: pg.Pool };

export const pool: pg.Pool =
  globalForPg.pgPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;
