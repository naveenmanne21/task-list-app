// CSV import for one user: limits, decoding, analysis, and a single
// transactional insert. Independent of HTTP so it can be tested directly;
// POST /api/import is a thin wrapper.
import type { PoolClient } from "pg";
import { withUser } from "@/lib/db/withUser";
import { analyzeCsv, sortByRow } from "./analyze";
import { duplicateKey } from "./dedupe";
import type { RejectedRow, ValidRow } from "./validate";

export const MAX_BYTES = 1024 * 1024; // 1 MB
export const MAX_ROWS = 5000;
export const DUPLICATE_OF_EXISTING = "Duplicate of existing task";
export const IMPORT_FAILED = "The import failed and no tasks were saved. Please try again.";

export type ImportResult = {
  imported: number;
  skippedBlank: number;
  totalRows: number;
  rejected: RejectedRow[];
};

export type ImportOutcome = { ok: true; result: ImportResult } | { ok: false; status: 400 | 413 | 500; error: string };

export async function importCsvBytes(userId: string, bytes: Uint8Array): Promise<ImportOutcome> {
  if (bytes.byteLength > MAX_BYTES) {
    return { ok: false, status: 413, error: "The file is larger than 1 MB. Split it into smaller files." };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, status: 400, error: "The file is not valid UTF-8 text. Save it as “CSV UTF-8” and try again." };
  }
  return importCsvText(userId, text);
}

export async function importCsvText(userId: string, text: string): Promise<ImportOutcome> {
  const analysis = analyzeCsv(text);
  if (!analysis.ok) return { ok: false, status: 400, error: analysis.error };
  if (analysis.totalRows > MAX_ROWS) {
    return {
      ok: false,
      status: 413,
      error: `The file has ${analysis.totalRows} data rows; the limit is ${MAX_ROWS}. Split it into smaller files.`,
    };
  }

  let inserted = new Set<string>();
  if (analysis.valid.length > 0) {
    try {
      inserted = await withUser(userId, (c) => insertValidRows(c, analysis.valid));
    } catch (err) {
      // withUser has rolled back: nothing from this file was saved.
      console.error("CSV import failed", err);
      return { ok: false, status: 500, error: IMPORT_FAILED };
    }
  }

  // Valid rows the insert skipped collided with an active task already in the account.
  const existing: RejectedRow[] = analysis.valid
    .filter((r) => !inserted.has(duplicateKey(r.input)))
    .map((r) => ({ row: r.row, reason: DUPLICATE_OF_EXISTING, data: r.data }));

  return {
    ok: true,
    result: {
      imported: inserted.size,
      skippedBlank: analysis.skippedBlank,
      totalRows: analysis.totalRows,
      rejected: sortByRow([...analysis.rejected, ...existing]),
    },
  };
}

/**
 * Inserts all rows in one statement (the caller's withUser transaction).
 * Rows clashing with an existing active task are skipped by ON CONFLICT; the
 * returned keys identify what was actually inserted. Rows are already unique
 * within the file, so keys map back to exactly one row each.
 */
export async function insertValidRows(client: PoolClient, rows: ValidRow[]): Promise<Set<string>> {
  const payload = rows.map(({ input }) => ({
    title: input.title,
    due_date: input.due_date,
    priority: input.priority,
    notes: input.notes,
  }));
  const { rows: returned } = await client.query<{ title: string; due_date: string }>(
    `INSERT INTO tasks (title, due_date, priority, notes)
     SELECT r.title, r.due_date, r.priority, r.notes
       FROM jsonb_to_recordset($1::jsonb) AS r(title text, due_date date, priority smallint, notes text)
     ON CONFLICT (user_id, title, due_date) WHERE deleted_at IS NULL DO NOTHING
     RETURNING title, due_date::text AS due_date`,
    [JSON.stringify(payload)],
  );
  return new Set(returned.map(duplicateKey));
}
