// Whole-file pipeline without the database: parse -> validate -> in-file dedupe.
// The service (DB insert, account duplicates) builds on this.
import { splitInFileDuplicates } from "./dedupe";
import { parseCsv } from "./parse";
import { joinReasons, validateRecord, type RejectedRow, type ValidRow } from "./validate";

export type Analysis =
  | { ok: false; error: string }
  | {
      ok: true;
      /** Data rows in the file (blank ones included; header and final line break excluded). */
      totalRows: number;
      skippedBlank: number;
      /** Valid and unique within the file, in file order. */
      valid: ValidRow[];
      /** Sorted by row number. */
      rejected: RejectedRow[];
    };

export function analyzeCsv(text: string): Analysis {
  const parsed = parseCsv(text);
  if (!parsed.ok) return parsed;
  const { csv } = parsed;

  let skippedBlank = 0;
  const valid: ValidRow[] = [];
  const rejected: RejectedRow[] = [];
  for (const record of csv.records) {
    const r = validateRecord(record, csv);
    if (r.kind === "blank") skippedBlank++;
    else if (r.kind === "invalid") rejected.push({ row: r.row, reason: joinReasons(r.reasons), data: r.data });
    else valid.push({ row: r.row, input: r.input, data: r.data });
  }

  const { unique, duplicates } = splitInFileDuplicates(valid);
  return {
    ok: true,
    totalRows: csv.records.length,
    skippedBlank,
    valid: unique,
    rejected: sortByRow([...rejected, ...duplicates]),
  };
}

export function sortByRow<T extends { row: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.row - b.row);
}
