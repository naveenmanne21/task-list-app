// List, search and filters as app_user through withUser.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/pool";
import { withUser } from "@/lib/db/withUser";
import type { TaskFilters } from "@/lib/tasks/filters";
import { countActiveTasks, createTask, listTasks, softDeleteTask } from "@/lib/tasks/queries";
import { taskInputSchema } from "@/lib/tasks/schema";
import { createUser, ownerPool, resetDb } from "../helpers/db";

let alice: string;
let bob: string;
let yesterday: string;
let today: string;
let tomorrow: string;

async function add(userId: string, t: { title: string; due_date?: string; priority?: number; status?: string; notes?: string }) {
  return withUser(userId, (c) =>
    createTask(c, taskInputSchema.parse({ due_date: tomorrow, priority: 3, ...t })),
  );
}

const titles = async (userId: string, filters: TaskFilters = {}) =>
  (await withUser(userId, (c) => listTasks(c, filters))).map((t) => t.title);

beforeEach(async () => {
  await resetDb();
  alice = await createUser("alice@example.test");
  bob = await createUser("bob@example.test");
  // Dates relative to the database's current_date, which the overdue filter uses.
  const { rows } = await ownerPool.query(
    "SELECT (current_date - 1)::text AS y, current_date::text AS t, (current_date + 1)::text AS n",
  );
  ({ y: yesterday, t: today, n: tomorrow } = rows[0]);
});

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
});

describe("listTasks", () => {
  it("sorts by due date, then priority (1 first)", async () => {
    await add(alice, { title: "later P1", due_date: "2027-01-02", priority: 1 });
    await add(alice, { title: "soon P5", due_date: "2027-01-01", priority: 5 });
    await add(alice, { title: "soon P2", due_date: "2027-01-01", priority: 2 });
    expect(await titles(alice)).toEqual(["soon P2", "soon P5", "later P1"]);
  });

  it("hides soft-deleted tasks from the list and the count", async () => {
    await add(alice, { title: "keep" });
    const gone = await add(alice, { title: "gone" });
    await withUser(alice, (c) => softDeleteTask(c, gone.id));
    expect(await titles(alice)).toEqual(["keep"]);
    expect(await titles(alice, { q: "gone" })).toEqual([]);
    expect(await withUser(alice, (c) => countActiveTasks(c))).toBe(1);
  });
});

describe("search", () => {
  beforeEach(async () => {
    await add(alice, { title: "Buy Milk", notes: "semi-skimmed" });
    await add(alice, { title: "Call plumber", notes: "Ask about the MILK frother" });
    await add(alice, { title: "Finish report", notes: "100% of section 2" });
    await add(alice, { title: "Read 1000 pages" });
    await add(alice, { title: "rename file_name" });
    await add(alice, { title: "rename filexname" });
    await add(alice, { title: "path C:\\temp" });
  });

  it("matches title and notes, case-insensitively", async () => {
    expect(await titles(alice, { q: "milk" })).toEqual(["Buy Milk", "Call plumber"]);
    expect(await titles(alice, { q: "SEMI" })).toEqual(["Buy Milk"]);
  });

  it('treats % literally: "100%" does not match "1000"', async () => {
    expect(await titles(alice, { q: "100%" })).toEqual(["Finish report"]);
    expect(await titles(alice, { q: "%" })).toEqual(["Finish report"]);
  });

  it("treats _ literally", async () => {
    expect(await titles(alice, { q: "file_name" })).toEqual(["rename file_name"]);
  });

  it("treats a backslash literally", async () => {
    expect(await titles(alice, { q: "C:\\temp" })).toEqual(["path C:\\temp"]);
  });

  it("returns nothing for no match", async () => {
    expect(await titles(alice, { q: "zebra" })).toEqual([]);
  });
});

describe("filters", () => {
  beforeEach(async () => {
    await add(alice, { title: "late todo", due_date: yesterday, status: "todo", priority: 1 });
    await add(alice, { title: "late in progress", due_date: yesterday, status: "in_progress", priority: 2 });
    await add(alice, { title: "late but done", due_date: yesterday, status: "done", priority: 1 });
    await add(alice, { title: "due today", due_date: today, status: "todo", priority: 3 });
    await add(alice, { title: "future", due_date: tomorrow, status: "in_progress", priority: 1 });
  });

  it("filters by status", async () => {
    expect(await titles(alice, { status: "done" })).toEqual(["late but done"]);
    expect(await titles(alice, { status: "in_progress" })).toEqual(["late in progress", "future"]);
  });

  it("filters by priority", async () => {
    expect(await titles(alice, { priority: 1 })).toEqual(["late todo", "late but done", "future"]);
    expect(await titles(alice, { priority: 5 })).toEqual([]);
  });

  it("overdue = due before today and not done (today itself is not overdue)", async () => {
    expect(await titles(alice, { overdue: true })).toEqual(["late todo", "late in progress"]);
  });

  it("combines filters and search", async () => {
    expect(await titles(alice, { overdue: true, priority: 1 })).toEqual(["late todo"]);
    expect(await titles(alice, { q: "late", status: "done" })).toEqual(["late but done"]);
  });
});

describe("isolation", () => {
  it("never returns another user's tasks, whatever the filters", async () => {
    await add(alice, { title: "alice secret", due_date: yesterday, priority: 1, notes: "100% private" });
    await add(bob, { title: "bob task" });

    const cases: TaskFilters[] = [{}, { q: "secret" }, { q: "100%" }, { priority: 1 }, { overdue: true }, { status: "todo" }];
    for (const filters of cases) {
      const bobTitles = await titles(bob, filters);
      expect(bobTitles, JSON.stringify(filters)).not.toContain("alice secret");
    }
    expect(await titles(bob)).toEqual(["bob task"]);
    expect(await withUser(bob, (c) => countActiveTasks(c))).toBe(1);
  });
});
