// The assessment's edge-case demo, end to end: fixtures/edge-cases.csv through
// the import service as app_user, uploaded twice.
//
// Fixture rows (header = row 1, Windows line endings):
//   2  Buy groceries   quoted field with commas          -> imported
//   3  Pay rent                                          -> imported
//   4  (empty line)                                      -> skipped (blank)
//   5  Call plumber    priority "high"                   -> rejected
//   6  aaaa…           title of 201 characters           -> rejected
//   7  Pay rent        same title + date as row 3        -> rejected (duplicate)
//   8  Book dentist    2026-02-30                        -> rejected
//   9  ,,,                                               -> skipped (blank)
//  10  Plan trip       quoted field with "" and a comma  -> imported
//  11  Renew passport  no notes cell at all              -> imported
//  12  Fix bike        unquoted comma (5 fields)         -> rejected
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/pool";
import { withUser } from "@/lib/db/withUser";
import { DUPLICATE_OF_EXISTING, importCsvBytes, type ImportResult } from "@/lib/import/service";
import { listTasks } from "@/lib/tasks/queries";
import { createUser, ownerPool, resetDb } from "../helpers/db";

const FIXTURE = path.resolve("fixtures/edge-cases.csv");

const INVALID_ROWS: [number, string][] = [
  [5, "Priority must be a whole number from 1 to 5"],
  [6, "Title must be at most 200 characters"],
  [7, "Duplicate of row 3"],
  [8, "Due date must be a real date in YYYY-MM-DD format"],
  [12, "Too many fields (check for an unquoted comma)"],
];
const IMPORTED_ROWS = [2, 3, 10, 11];

let userId: string;
let first: ImportResult;
let second: ImportResult;

async function upload(): Promise<ImportResult> {
  // Raw bytes, as the endpoint receives them.
  const outcome = await importCsvBytes(userId, new Uint8Array(readFileSync(FIXTURE)));
  if (!outcome.ok) throw new Error(`import failed: ${outcome.error}`);
  return outcome.result;
}

const reasons = (r: ImportResult) => r.rejected.map((x): [number, string] => [x.row, x.reason]);

beforeAll(async () => {
  await resetDb();
  userId = await createUser("demo@example.test");
  first = await upload();
  second = await upload();
});

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
});

describe("edge-case fixture", () => {
  it("is a small CRLF file with the required cases", () => {
    const text = readFileSync(FIXTURE, "utf8");
    expect(text.split("\r\n").length - 1).toBeLessThan(40);
    expect(text).toContain('"Milk, eggs, and bread"'); // quoted field with a comma
    expect(text).toContain(",high,");
    expect(text).toContain("a".repeat(201) + ",");
  });
});

describe("first upload", () => {
  it("imports the 4 valid rows and skips the 2 blank rows", () => {
    expect(first.totalRows).toBe(11);
    expect(first.imported).toBe(4);
    expect(first.skippedBlank).toBe(2);
  });

  it("rejects each bad row with its row number and reason", () => {
    expect(reasons(first)).toEqual(INVALID_ROWS);
  });

  it("stores exactly the valid rows, with quoted commas and quotes intact", async () => {
    const tasks = await withUser(userId, (c) => listTasks(c));
    expect(tasks.map((t) => [t.title, t.due_date, t.priority, t.notes])).toEqual([
      ["Pay rent", "2026-11-01", 1, null],
      ["Buy groceries", "2026-11-05", 2, "Milk, eggs, and bread"],
      ["Renew passport", "2026-12-01", 5, null],
      ["Plan trip", "2026-12-20", 4, 'She said "go", so we go'],
    ]);
  });
});

describe("second upload of the same file", () => {
  it("imports nothing and still skips the blank rows", () => {
    expect(second.imported).toBe(0);
    expect(second.skippedBlank).toBe(2);
  });

  it("rejects every previously imported row as a duplicate of an existing task", () => {
    const dupes = second.rejected.filter((r) => r.reason === DUPLICATE_OF_EXISTING).map((r) => r.row);
    expect(dupes).toEqual(IMPORTED_ROWS);
  });

  it("keeps the original reasons for the invalid rows", () => {
    expect(reasons(second).filter(([, reason]) => reason !== DUPLICATE_OF_EXISTING)).toEqual(INVALID_ROWS);
    expect(second.rejected).toHaveLength(IMPORTED_ROWS.length + INVALID_ROWS.length);
  });

  it("leaves the stored tasks unchanged", async () => {
    expect(await withUser(userId, (c) => listTasks(c))).toHaveLength(4);
  });
});
