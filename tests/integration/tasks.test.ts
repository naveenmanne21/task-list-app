// Task queries as app_user through withUser — the same path the Server Actions use.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/pool";
import { withUser } from "@/lib/db/withUser";
import {
  createTask,
  getTask,
  isUniqueViolation,
  listTasks,
  setTaskStatus,
  softDeleteTask,
  updateTask,
} from "@/lib/tasks/queries";
import { taskInputSchema, type TaskInput } from "@/lib/tasks/schema";
import { createUser, ownerPool, resetDb } from "../helpers/db";

let alice: string;
let bob: string;

const input = (over: Partial<Record<keyof TaskInput, unknown>> = {}): TaskInput =>
  taskInputSchema.parse({ title: "Pay rent", due_date: "2026-11-01", priority: 2, ...over });

const asAlice = <T>(fn: Parameters<typeof withUser<T>>[1]) => withUser(alice, fn);
const asBob = <T>(fn: Parameters<typeof withUser<T>>[1]) => withUser(bob, fn);

beforeEach(async () => {
  await resetDb();
  alice = await createUser("alice@example.test");
  bob = await createUser("bob@example.test");
});

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
});

describe("create / edit / complete / soft delete", () => {
  it("creates a task owned by the current user", async () => {
    const task = await asAlice((c) => createTask(c, input({ notes: "by the 1st" })));
    expect(task).toMatchObject({
      title: "Pay rent",
      due_date: "2026-11-01",
      priority: 2,
      status: "todo",
      notes: "by the 1st",
    });
    const { rows } = await ownerPool.query("SELECT user_id FROM tasks WHERE id = $1", [task.id]);
    expect(rows[0].user_id).toBe(alice);
  });

  it("edits a task", async () => {
    const task = await asAlice((c) => createTask(c, input()));
    const updated = await asAlice((c) =>
      updateTask(c, task.id, input({ title: "Pay rent (Nov)", priority: 1, status: "in_progress", notes: "x" })),
    );
    expect(updated).toMatchObject({ id: task.id, title: "Pay rent (Nov)", priority: 1, status: "in_progress", notes: "x" });
    expect(await asAlice((c) => getTask(c, task.id))).toMatchObject({ title: "Pay rent (Nov)" });
  });

  it("completes and reopens a task", async () => {
    const task = await asAlice((c) => createTask(c, input()));
    expect(await asAlice((c) => setTaskStatus(c, task.id, "done"))).toBe(true);
    expect((await asAlice((c) => getTask(c, task.id)))?.status).toBe("done");
    expect(await asAlice((c) => setTaskStatus(c, task.id, "todo"))).toBe(true);
    expect((await asAlice((c) => getTask(c, task.id)))?.status).toBe("todo");
  });

  it("soft deletes: deleted_at is set, the row stays, and it can't be edited or deleted again", async () => {
    const task = await asAlice((c) => createTask(c, input()));
    expect(await asAlice((c) => softDeleteTask(c, task.id))).toBe(true);

    const { rows } = await ownerPool.query("SELECT deleted_at FROM tasks WHERE id = $1", [task.id]);
    expect(rows[0].deleted_at).toBeInstanceOf(Date);

    expect(await asAlice((c) => getTask(c, task.id))).toBeNull();
    expect(await asAlice((c) => updateTask(c, task.id, input({ title: "zombie" })))).toBeNull();
    expect(await asAlice((c) => setTaskStatus(c, task.id, "done"))).toBe(false);
    expect(await asAlice((c) => softDeleteTask(c, task.id))).toBe(false);
  });

  it("hides soft-deleted tasks from the list", async () => {
    const keep = await asAlice((c) => createTask(c, input({ title: "Keep" })));
    const gone = await asAlice((c) => createTask(c, input({ title: "Gone" })));
    await asAlice((c) => softDeleteTask(c, gone.id));
    expect((await asAlice((c) => listTasks(c))).map((t) => t.id)).toEqual([keep.id]);
  });
});

describe("duplicates", () => {
  it("raises a unique violation for the same title + due date on create", async () => {
    await asAlice((c) => createTask(c, input()));
    const err = await asAlice((c) => createTask(c, input({ title: "  Pay rent  " }))).catch((e) => e);
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("raises a unique violation when an edit collides with another task", async () => {
    await asAlice((c) => createTask(c, input({ title: "A" })));
    const b = await asAlice((c) => createTask(c, input({ title: "B" })));
    const err = await asAlice((c) => updateTask(c, b.id, input({ title: "A" }))).catch((e) => e);
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("treats titles case-sensitively and different dates as distinct", async () => {
    await asAlice((c) => createTask(c, input()));
    await expect(asAlice((c) => createTask(c, input({ title: "pay rent" })))).resolves.toBeDefined();
    await expect(asAlice((c) => createTask(c, input({ due_date: "2026-12-01" })))).resolves.toBeDefined();
  });

  it("ignores soft-deleted tasks", async () => {
    const task = await asAlice((c) => createTask(c, input()));
    await asAlice((c) => softDeleteTask(c, task.id));
    await expect(asAlice((c) => createTask(c, input()))).resolves.toBeDefined();
  });
});

describe("another user", () => {
  it("can't read, edit, complete or delete Alice's task", async () => {
    const task = await asAlice((c) => createTask(c, input()));
    expect(await asBob((c) => getTask(c, task.id))).toBeNull();
    expect(await asBob((c) => listTasks(c))).toEqual([]);
    expect(await asBob((c) => updateTask(c, task.id, input({ title: "hacked" })))).toBeNull();
    expect(await asBob((c) => setTaskStatus(c, task.id, "done"))).toBe(false);
    expect(await asBob((c) => softDeleteTask(c, task.id))).toBe(false);
    expect(await asAlice((c) => getTask(c, task.id))).toMatchObject({ title: "Pay rent", status: "todo" });
  });

  it("can use the same title + due date as Alice", async () => {
    await asAlice((c) => createTask(c, input()));
    await expect(asBob((c) => createTask(c, input()))).resolves.toBeDefined();
  });
});
