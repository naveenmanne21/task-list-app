// Rejected rows -> downloadable CSV. Pure; runs in the browser too.
import Papa from "papaparse";
import type { RejectedRow } from "./validate";

export const REJECTED_CSV_COLUMNS = ["title", "due_date", "priority", "notes", "row_number", "reason"] as const;

/**
 * RFC 4180 output (CRLF; fields with commas, quotes or line breaks are quoted).
 * Cells starting with = + - @ get a leading single quote so spreadsheet apps
 * don't evaluate them as formulas (CSV injection).
 */
export function buildRejectedCsv(rows: RejectedRow[]): string {
  return Papa.unparse(
    {
      fields: [...REJECTED_CSV_COLUMNS],
      data: rows.map((r) => [r.data.title, r.data.due_date, r.data.priority, r.data.notes, String(r.row), r.reason]),
    },
    { newline: "\r\n", escapeFormulae: /^[=+\-@]/ },
  );
}
