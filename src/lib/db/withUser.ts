import type { PoolClient } from "pg";
import { pool } from "./pool";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs fn inside a transaction in which RLS sees `userId` as the current user.
 *
 * The setting is transaction-local (set_config(..., true)), so it ends with
 * COMMIT/ROLLBACK and can't leak to the next request that reuses this pooled
 * connection. All task queries must go through here.
 */
export async function withUser<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(userId)) throw new Error("withUser: userId must be a UUID");

  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      // Connection is unusable; make release() destroy it instead of pooling it.
      broken = rollbackErr as Error;
    }
    throw err;
  } finally {
    client.release(broken);
  }
}
