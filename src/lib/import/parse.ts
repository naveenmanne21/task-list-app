// CSV text -> header + records with exact row numbers. Pure.
//
// papaparse runs with header:false and skipEmptyLines:false so that every
// record (including blank ones) keeps its position: the header is row 1 and
// data record i (1-based) is row i + 1. A quoted field may span several
// physical lines; it is still one record, so one row number.
import Papa from "papaparse";

export const REQUIRED_COLUMNS = ["title", "due_date", "priority"] as const;
export const OPTIONAL_COLUMNS = ["notes"] as const;
export type Column = (typeof REQUIRED_COLUMNS)[number] | (typeof OPTIONAL_COLUMNS)[number];

export type CsvRecord = { row: number; cells: string[] };

export type ParsedCsv = {
  /** Header cells, trimmed and lowercased, in file order. */
  header: string[];
  /** Index of each known column in `header`; notes may be absent. */
  columns: Record<Column, number | undefined>;
  records: CsvRecord[];
};

export type ParseResult = { ok: true; csv: ParsedCsv } | { ok: false; error: string };

export function parseCsv(input: string): ParseResult {
  const text = input.replace(/^﻿/, "");
  if (text.trim() === "") return { ok: false, error: "The file is empty." };

  const result = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false, delimiter: "," });
  if (result.errors.length > 0) {
    const e = result.errors[0];
    const where = typeof e.row === "number" ? ` (starting at row ${e.row + 1})` : "";
    const what = e.code === "MissingQuotes" ? "a quoted field is never closed" : e.message.toLowerCase();
    return { ok: false, error: `The file could not be read as CSV: ${what}${where}.` };
  }

  const data = result.data;
  // A final line break makes papaparse emit one extra [""] record; it isn't a row.
  if (/[\r\n]$/.test(text) && data.length > 0 && isTrailingEmpty(data[data.length - 1])) data.pop();

  const header = (data[0] ?? []).map((h) => h.trim().toLowerCase());
  const columnsResult = resolveColumns(header);
  if (!columnsResult.ok) return columnsResult;

  const records = data.slice(1).map((cells, i) => ({ row: i + 2, cells }));
  if (records.length === 0) return { ok: false, error: "The file has a header row but no data rows." };

  return { ok: true, csv: { header, columns: columnsResult.columns, records } };
}

function isTrailingEmpty(cells: string[]): boolean {
  return cells.length === 1 && cells[0] === "";
}

function resolveColumns(
  header: string[],
): { ok: true; columns: ParsedCsv["columns"] } | { ok: false; error: string } {
  const known = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS] as Column[];
  const columns = {} as ParsedCsv["columns"];
  for (const name of known) {
    const indexes = header.flatMap((h, i) => (h === name ? [i] : []));
    if (indexes.length > 1) return { ok: false, error: `The column "${name}" appears more than once in the header.` };
    columns[name] = indexes[0];
  }
  const missing = REQUIRED_COLUMNS.filter((c) => columns[c] === undefined);
  if (missing.length > 0) {
    const list = missing.map((c) => `"${c}"`).join(", ");
    return {
      ok: false,
      error: `Missing required column${missing.length > 1 ? "s" : ""} ${list}. The first row must be a header with title, due_date, priority and (optionally) notes.`,
    };
  }
  return { ok: true, columns };
}
