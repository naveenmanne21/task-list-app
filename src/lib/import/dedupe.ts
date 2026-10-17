// In-file duplicate detection. Pure.
import type { TaskInput } from "@/lib/tasks/schema";
import type { RejectedRow, ValidRow } from "./validate";

/** Duplicate key: exact trimmed title + due date (titles are already trimmed by the schema). */
export function duplicateKey(t: Pick<TaskInput, "title" | "due_date">): string {
  return `${t.title}\u0000${t.due_date}`;
}

/**
 * The first VALID row with a given key wins; later valid rows with the same key
 * are rejected as "Duplicate of row N". Invalid rows never claim a key, so a
 * valid row after an invalid one with the same title/date is not a duplicate.
 * Input must be in file order.
 */
export function splitInFileDuplicates(validRows: ValidRow[]): { unique: ValidRow[]; duplicates: RejectedRow[] } {
  const firstRowByKey = new Map<string, number>();
  const unique: ValidRow[] = [];
  const duplicates: RejectedRow[] = [];
  for (const r of validRows) {
    const key = duplicateKey(r.input);
    const first = firstRowByKey.get(key);
    if (first === undefined) {
      firstRowByKey.set(key, r.row);
      unique.push(r);
    } else {
      duplicates.push({ row: r.row, reason: `Duplicate of row ${first}`, data: r.data });
    }
  }
  return { unique, duplicates };
}
