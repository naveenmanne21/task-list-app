// One CSV record -> blank / invalid (with every reason) / valid task input. Pure.
// Field rules come from the shared task schema, so CSV and UI can't diverge.
import { taskInputSchema, type TaskInput } from "@/lib/tasks/schema";
import type { CsvRecord, ParsedCsv } from "./parse";

/** The row's original values, as shown in the UI and the rejected-rows CSV. */
export type RawRow = { title: string; due_date: string; priority: string; notes: string };

export type RejectedRow = { row: number; reason: string; data: RawRow };
export type ValidRow = { row: number; input: TaskInput; data: RawRow };

export type RecordResult =
  | { kind: "blank"; row: number }
  | { kind: "invalid"; row: number; reasons: string[]; data: RawRow }
  | { kind: "valid"; row: number; input: TaskInput; data: RawRow };

export const TOO_MANY_FIELDS = "Too many fields (check for an unquoted comma)";

const FIELD_ORDER = ["title", "due_date", "priority", "notes"] as const;

export function isBlankRecord(cells: string[]): boolean {
  return cells.every((c) => c.trim() === "");
}

export function rawRow(record: CsvRecord, columns: ParsedCsv["columns"]): RawRow {
  const cell = (i: number | undefined) => (i === undefined ? "" : (record.cells[i] ?? ""));
  return {
    title: cell(columns.title),
    due_date: cell(columns.due_date),
    priority: cell(columns.priority),
    notes: cell(columns.notes),
  };
}

export function validateRecord(record: CsvRecord, csv: Pick<ParsedCsv, "header" | "columns">): RecordResult {
  const { row, cells } = record;
  if (isBlankRecord(cells)) return { kind: "blank", row };

  const data = rawRow(record, csv.columns);

  // Values are shifted, so per-field errors would be misleading; this is the only reason.
  if (cells.length > csv.header.length) return { kind: "invalid", row, reasons: [TOO_MANY_FIELDS], data };

  // Missing trailing cells are "" (see rawRow) and are reported by the schema.
  const parsed = taskInputSchema.safeParse({ ...data, status: "todo" });
  if (parsed.success) return { kind: "valid", row, input: parsed.data, data };

  const byField = new Map<string, string[]>();
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0]);
    const list = byField.get(field) ?? [];
    list.push(issue.message.replace(/\.$/, ""));
    byField.set(field, list);
  }
  const reasons = FIELD_ORDER.flatMap((f) => byField.get(f) ?? []);
  return { kind: "invalid", row, reasons, data };
}

export function joinReasons(reasons: string[]): string {
  return reasons.join("; ");
}
