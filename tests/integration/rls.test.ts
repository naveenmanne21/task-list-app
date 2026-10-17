// Row-level security and grants on tasks, exercised as app_user (the role the
// app connects as). The owner pool is used only to create users, reset the DB,
// and inspect rows behind RLS.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db/pool";
import { withUser } from "@/lib/db/withUser";
import { createUser, ownerPool, resetDb } from "../helpers/db";

let alice: string;
let bob: string;
let aliceTaskId: string;

async function insertTask(client: PoolClient, title = "Alice task", dueDate = "2026-11-01") {
  const { rows } = await client.query<{ id: string; user_id: string }>(
    "INSERT INTO tasks (title, due_date, priority) VALUES ($1, $2, 3) RETURNING id, user_id",
    [title, dueDate],
  );
  return rows[0];
}

async function ownerGetTask(id: string) {
  const { rows } = await ownerPool.query("SELECT * FROM tasks WHERE id = $1", [id]);
  return rows[0];
}

beforeEach(async () => {
  await resetDb();
  alice = await createUser("alice@example.test");
  bob = await createUser("bob@example.test");
  aliceTaskId = (await withUser(alice, (c) => insertTask(c))).id;
});

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
});

describe("isolation between users", () => {
  it("fills user_id from the current user by default", async () => {
    expect((await ownerGetTask(aliceTaskId)).user_id).toBe(alice);
  });

  it("lets the owner see their task", async () => {
    const { rows } = await withUser(alice, (c) => c.query("SELECT id FROM tasks"));
    expect(rows.map((r) => r.id)).toEqual([aliceTaskId]);
  });

  it("shows another user 0 of Alice's rows", async () => {
    const { rowCount } = await withUser(bob, (c) => c.query("SELECT * FROM tasks"));
    expect(rowCount).toBe(0);
    const byId = await withUser(bob, (c) => c.query("SELECT * FROM tasks WHERE id = $1", [aliceTaskId]));
    expect(byId.rowCount).toBe(0);
  });

  it("makes another user's update and soft delete affect 0 rows", async () => {
    const update = await withUser(bob, (c) =>
      c.query("UPDATE tasks SET title = 'hacked' WHERE id = $1", [aliceTaskId]),
    );
    const softDelete = await withUser(bob, (c) =>
      c.query("UPDATE tasks SET deleted_at = now() WHERE id = $1", [aliceTaskId]),
    );
    expect(update.rowCount).toBe(0);
    expect(softDelete.rowCount).toBe(0);

    const row = await ownerGetTask(aliceTaskId);
    expect(row.title).toBe("Alice task");
    expect(row.deleted_at).toBeNull();
  });

  it("rejects inserting a task with another user's user_id", async () => {
    await expect(
      withUser(bob, (c) =>
        c.query("INSERT INTO tasks (user_id, title, due_date, priority) VALUES ($1, 'x', '2026-11-01', 1)", [alice]),
      ),
    ).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/row-level security/) });
  });
});

describe("no current user", () => {
  it("returns 0 rows when app.user_id was never set", async () => {
    const { rowCount } = await pool.query("SELECT * FROM tasks");
    expect(rowCount).toBe(0);
  });

  it("returns 0 rows (no error) on a reused connection after a transaction-local setting ended", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [alice]);
      expect((await client.query("SELECT * FROM tasks")).rowCount).toBe(1);
      await client.query("COMMIT");

      // Postgres now reports '' (not NULL); app_current_user_id() must map it to NULL.
      const setting = await client.query("SELECT current_setting('app.user_id', true) AS v");
      expect(setting.rows[0].v).toBe("");
      expect((await client.query("SELECT * FROM tasks")).rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it("rejects inserts with no current user", async () => {
    await expect(
      pool.query("INSERT INTO tasks (title, due_date, priority) VALUES ('x', '2026-11-01', 1)"),
      // user_id defaults to NULL; the RLS WITH CHECK runs before NOT NULL and rejects it.
    ).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/row-level security/) });
  });
});

describe("grants", () => {
  it("denies hard DELETE, even for the row's owner", async () => {
    await expect(
      withUser(alice, (c) => c.query("DELETE FROM tasks WHERE id = $1", [aliceTaskId])),
    ).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied/) });
    expect(await ownerGetTask(aliceTaskId)).toBeDefined();
  });

  it("denies changing user_id", async () => {
    await expect(
      withUser(alice, (c) => c.query("UPDATE tasks SET user_id = $1 WHERE id = $2", [bob, aliceTaskId])),
    ).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied/) });
    expect((await ownerGetTask(aliceTaskId)).user_id).toBe(alice);
  });

  it("denies setting updated_at directly, but the trigger maintains it", async () => {
    await expect(
      withUser(alice, (c) => c.query("UPDATE tasks SET updated_at = '2000-01-01' WHERE id = $1", [aliceTaskId])),
    ).rejects.toMatchObject({ code: "42501" });

    const before = (await ownerGetTask(aliceTaskId)).updated_at as Date;
    await withUser(alice, (c) => c.query("UPDATE tasks SET status = 'done' WHERE id = $1", [aliceTaskId]));
    const after = (await ownerGetTask(aliceTaskId)).updated_at as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});

describe("soft delete and duplicates", () => {
  it("soft deletes: the row stays, with deleted_at set", async () => {
    const { rowCount } = await withUser(alice, (c) =>
      c.query("UPDATE tasks SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", [aliceTaskId]),
    );
    expect(rowCount).toBe(1);

    const active = await withUser(alice, (c) => c.query("SELECT id FROM tasks WHERE deleted_at IS NULL"));
    expect(active.rowCount).toBe(0);
    expect((await ownerGetTask(aliceTaskId)).deleted_at).toBeInstanceOf(Date);
  });

  it("rejects a duplicate title + due date for the same user with 23505", async () => {
    await expect(withUser(alice, (c) => insertTask(c))).rejects.toMatchObject({
      code: "23505",
      constraint: "tasks_user_title_due_key",
    });
  });

  it("allows the same title + due date for a different user", async () => {
    await expect(withUser(bob, (c) => insertTask(c))).resolves.toMatchObject({ user_id: bob });
  });

  it("allows the same title + due date again after a soft delete", async () => {
    await withUser(alice, (c) => c.query("UPDATE tasks SET deleted_at = now() WHERE id = $1", [aliceTaskId]));
    const recreated = await withUser(alice, (c) => insertTask(c));
    expect(recreated.id).not.toBe(aliceTaskId);
  });
});

describe("withUser", () => {
  it("rolls back the whole transaction when fn throws", async () => {
    await expect(
      withUser(alice, async (c) => {
        await insertTask(c, "Rolled back");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const { rows } = await ownerPool.query("SELECT 1 FROM tasks WHERE title = 'Rolled back'");
    expect(rows).toHaveLength(0);
  });

  it("rejects a non-UUID user id", async () => {
    await expect(withUser("", async () => 1)).rejects.toThrow(/UUID/);
  });
});
