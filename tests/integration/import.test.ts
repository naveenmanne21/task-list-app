// CSV import service against the test DB, as app_user through withUser.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/pool";
import { withUser } from "@/lib/db/withUser";
import {
  DUPLICATE_OF_EXISTING,
  IMPORT_FAILED,
  importCsvBytes,
  importCsvText,
  MAX_BYTES,
  MAX_ROWS,
  type ImportOutcome,
} from "@/lib/import/service";
import { TOO_MANY_FIELDS } from "@/lib/import/validate";
import { createTask, listTasks, softDeleteTask } from "@/lib/tasks/queries";
import { taskInputSchema } from "@/lib/tasks/schema";
import { createUser, ownerPool, resetDb } from "../helpers/db";

const HEADER = "title,due_date,priority,notes";
const csv = (...lines: string[]) => [HEADER, ...lines].join("\n") + "\n";
const fixture = readFileSync(path.resolve("fixtures/edge-cases.csv"), "utf8");

let alice: string;
let bob: string;

function ok(outcome: ImportOutcome) {
  if (!outcome.ok) throw new Error(`import failed: ${outcome.error}`);
  return outcome.result;
}

const tasksOf = async (userId: string) =>
  (await withUser(userId, (c) => listTasks(c))).map((t) => `${t.title}|${t.due_date}|${t.priority}`).sort();

const rowsAndReasons = (r: { rejected: { row: number; reason: string }[] }) =>
  r.rejected.map((x) => [x.row, x.reason]);

beforeEach(async () => {
  await resetDb();
  alice = await createUser("alice@example.test");
  bob = await createUser("bob@example.test");
});

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
});

describe("importing valid rows", () => {
  it("inserts the valid rows of the edge-case file for the importing user", async () => {
    const result = ok(await importCsvText(alice, fixture));
    expect(result).toMatchObject({ imported: 4, skippedBlank: 2, totalRows: 11 });
    expect(rowsAndReasons(result)).toEqual([
      [5, "Priority must be a whole number from 1 to 5"],
      [6, "Title must be at most 200 characters"],
      [7, "Duplicate of row 3"],
      [8, "Due date must be a real date in YYYY-MM-DD format"],
      [12, TOO_MANY_FIELDS],
    ]);
    expect(await tasksOf(alice)).toEqual([
      "Buy groceries|2026-11-05|2",
      "Pay rent|2026-11-01|1",
      "Plan trip|2026-12-20|4",
      "Renew passport|2026-12-01|5",
    ]);

    const tasks = await withUser(alice, (c) => listTasks(c));
    expect(tasks.find((t) => t.title === "Buy groceries")).toMatchObject({ notes: "Milk, eggs, and bread", status: "todo" });
    expect(tasks.find((t) => t.title === "Renew passport")?.notes).toBeNull();

    const { rows } = await ownerPool.query("SELECT DISTINCT user_id FROM tasks");
    expect(rows).toEqual([{ user_id: alice }]);
  });

  it("returns the original values of rejected rows", async () => {
    const result = ok(await importCsvText(alice, csv("  Call plumber ,2026-11-10,high,Leaking tap")));
    expect(result.rejected[0]).toEqual({
      row: 2,
      reason: "Priority must be a whole number from 1 to 5",
      data: { title: "  Call plumber ", due_date: "2026-11-10", priority: "high", notes: "Leaking tap" },
    });
  });

  it("does not touch the database when no row is valid", async () => {
    const result = ok(await importCsvText(alice, csv("A,bad-date,1,", ",,,")));
    expect(result).toMatchObject({ imported: 0, skippedBlank: 1, totalRows: 2 });
    expect(await tasksOf(alice)).toEqual([]);
  });
});

describe("account duplicates", () => {
  it("rejects rows matching existing active tasks, with the right row numbers", async () => {
    await withUser(alice, async (c) => {
      await createTask(c, taskInputSchema.parse({ title: "Existing B", due_date: "2026-01-02", priority: 1 }));
      await createTask(c, taskInputSchema.parse({ title: "Existing E", due_date: "2026-01-05", priority: 1 }));
    });
    // Duplicates are interleaved with new rows and an invalid row, so mapping by
    // position would give the wrong row numbers.
    const result = ok(
      await importCsvText(
        alice,
        csv(
          "New A,2026-01-01,1,", // row 2
          "Existing B,2026-01-02,3,different notes and priority", // row 3 -> duplicate
          "Bad,2026-02-30,1,", // row 4 -> invalid
          "New D,2026-01-04,1,", // row 5
          "Existing E,2026-01-05,2,", // row 6 -> duplicate
          "Existing B,2026-01-03,1,", // row 7 -> different date, new
        ),
      ),
    );
    expect(result.imported).toBe(3);
    expect(rowsAndReasons(result)).toEqual([
      [3, DUPLICATE_OF_EXISTING],
      [4, "Due date must be a real date in YYYY-MM-DD format"],
      [6, DUPLICATE_OF_EXISTING],
    ]);
    // The existing task was not modified.
    expect(await tasksOf(alice)).toContain("Existing B|2026-01-02|1");
  });

  it("rejects every row when the same file is imported twice", async () => {
    const first = ok(await importCsvText(alice, fixture));
    const second = ok(await importCsvText(alice, fixture));
    expect(second.imported).toBe(0);
    expect(second.skippedBlank).toBe(first.skippedBlank);
    expect(second.rejected).toHaveLength(second.totalRows - second.skippedBlank);
    expect(rowsAndReasons(second)).toEqual([
      [2, DUPLICATE_OF_EXISTING],
      [3, DUPLICATE_OF_EXISTING],
      [5, "Priority must be a whole number from 1 to 5"],
      [6, "Title must be at most 200 characters"],
      [7, "Duplicate of row 3"],
      [8, "Due date must be a real date in YYYY-MM-DD format"],
      [10, DUPLICATE_OF_EXISTING],
      [11, DUPLICATE_OF_EXISTING],
      [12, TOO_MANY_FIELDS],
    ]);
    expect(await tasksOf(alice)).toHaveLength(4);
  });

  it("does not count soft-deleted tasks as duplicates", async () => {
    ok(await importCsvText(alice, csv("Pay rent,2026-11-01,1,", "Other,2026-11-02,2,")));
    const rent = (await withUser(alice, (c) => listTasks(c))).find((t) => t.title === "Pay rent")!;
    await withUser(alice, (c) => softDeleteTask(c, rent.id));

    const again = ok(await importCsvText(alice, csv("Pay rent,2026-11-01,1,", "Other,2026-11-02,2,")));
    expect(again.imported).toBe(1);
    expect(rowsAndReasons(again)).toEqual([[3, DUPLICATE_OF_EXISTING]]);
    expect(await tasksOf(alice)).toEqual(["Other|2026-11-02|2", "Pay rent|2026-11-01|1"]);
  });

  it("lets another user import the same rows", async () => {
    ok(await importCsvText(alice, fixture));
    const forBob = ok(await importCsvText(bob, fixture));
    expect(forBob.imported).toBe(4);
    expect(await tasksOf(bob)).toEqual(await tasksOf(alice));
    const { rows } = await ownerPool.query("SELECT user_id, count(*)::int AS n FROM tasks GROUP BY user_id ORDER BY n");
    expect(rows.map((r) => r.n)).toEqual([4, 4]);
  });
});

describe("atomicity", () => {
  it("leaves nothing inserted when the database fails mid-import", async () => {
    // A trigger that fails on one row in the middle of the batch.
    await ownerPool.query(`
      CREATE FUNCTION test_fail_on_boom() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.title = 'boom' THEN RAISE EXCEPTION 'simulated failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_fail_on_boom BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION test_fail_on_boom();`);
    try {
      const outcome = await importCsvText(alice, csv("First,2026-01-01,1,", "boom,2026-01-02,1,", "Last,2026-01-03,1,"));
      expect(outcome).toEqual({ ok: false, status: 500, error: IMPORT_FAILED });
      const { rows } = await ownerPool.query("SELECT count(*)::int AS n FROM tasks");
      expect(rows[0].n).toBe(0);
    } finally {
      await ownerPool.query(
        "DROP TRIGGER IF EXISTS test_fail_on_boom ON tasks; DROP FUNCTION IF EXISTS test_fail_on_boom();",
      );
    }
  });
});

describe("limits and whole-file errors", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it("decodes UTF-8 bytes (including a BOM and non-ASCII text)", async () => {
    const result = ok(await importCsvBytes(alice, bytes("﻿" + csv("Café ☕,2026-01-01,1,naïve"))));
    expect(result.imported).toBe(1);
    expect(await tasksOf(alice)).toEqual(["Café ☕|2026-01-01|1"]);
  });

  it("rejects bytes that are not valid UTF-8", async () => {
    const latin1 = new Uint8Array([...bytes(`${HEADER}\nCaf`), 0xe9, ...bytes(",2026-01-01,1,\n")]);
    expect(await importCsvBytes(alice, latin1)).toMatchObject({ ok: false, status: 400, error: /UTF-8/ });
  });

  it("rejects files over 1 MB", async () => {
    const big = new Uint8Array(MAX_BYTES + 1).fill(0x61);
    expect(await importCsvBytes(alice, big)).toMatchObject({ ok: false, status: 413, error: /1 MB/ });
  });

  it(`allows ${MAX_ROWS} data rows and rejects ${MAX_ROWS + 1}`, async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => `Task ${i},2026-01-01,1,`);
    const atLimit = ok(await importCsvText(alice, csv(...rows(MAX_ROWS))));
    expect(atLimit.imported).toBe(MAX_ROWS);
    expect(await importCsvText(alice, csv(...rows(MAX_ROWS + 1)))).toMatchObject({
      ok: false,
      status: 413,
      error: /5001 data rows; the limit is 5000/,
    });
  });

  it.each([
    ["an empty file", "", /empty/],
    ["a missing column", "title,priority\nA,1\n", /Missing required column "due_date"/],
    ["an unterminated quote", csv('"A,2026-01-01,1,'), /never closed/],
  ])("reports %s as a whole-file error and imports nothing", async (_label, text, message) => {
    expect(await importCsvText(alice, text)).toMatchObject({ ok: false, status: 400, error: message });
    expect(await tasksOf(alice)).toEqual([]);
  });
});
