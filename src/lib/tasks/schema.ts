// Task validation shared by create and edit (and the field rules reused by
// CSV import). Pure: no DB or Next.js imports, so it is unit-testable.
import { z } from "zod";

export const STATUSES = ["todo", "in_progress", "done"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<Status, string> = { todo: "To do", in_progress: "In progress", done: "Done" };

export const TITLE_MAX = 200;
export const NOTES_MAX = 10_000;
export const DUPLICATE_TASK = "A task with this title and due date already exists.";

/** Length in Unicode code points, matching Postgres char_length(). */
export function codePointLength(s: string): number {
  return [...s].length;
}

/** True for a real calendar date written exactly as YYYY-MM-DD. */
export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  date.setUTCFullYear(y); // Date.UTC maps years 0-99 to 1900-1999
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** A whole number 1-5 written as plain digits ("3"), or the number itself. Otherwise null. */
export function parsePriority(value: unknown): number | null {
  if (typeof value === "string") {
    const s = value.trim();
    if (!/^\d+$/.test(s)) return null;
    value = Number(s);
  }
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

const title = z
  .string({ error: "Title is required." })
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, "Title is required.")
  .refine((s) => codePointLength(s) <= TITLE_MAX, `Title must be at most ${TITLE_MAX} characters.`);

const dueDate = z
  .string({ error: "Due date is required." })
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, "Due date is required.")
  .refine((s) => s.length === 0 || isValidIsoDate(s), "Due date must be a real date in YYYY-MM-DD format.");

const priority = z
  .union([z.string(), z.number()], { error: "Priority is required." })
  .transform((v, ctx) => {
    if (typeof v === "string" && v.trim() === "") {
      ctx.addIssue({ code: "custom", message: "Priority is required." });
      return z.NEVER;
    }
    const p = parsePriority(v);
    if (p === null) {
      ctx.addIssue({ code: "custom", message: "Priority must be a whole number from 1 to 5." });
      return z.NEVER;
    }
    return p;
  });

const notes = z
  .string()
  .nullish()
  .transform((s) => (s?.trim() ? s.trim() : null))
  .refine((s) => s === null || codePointLength(s) <= NOTES_MAX, `Notes must be at most ${NOTES_MAX} characters.`);

export const taskInputSchema = z.object({
  title,
  due_date: dueDate,
  priority,
  notes,
  status: z.enum(STATUSES, { error: "Choose a valid status." }).default("todo"),
});

export type TaskInput = z.output<typeof taskInputSchema>;
export type TaskField = keyof TaskInput;
export type TaskFieldErrors = Partial<Record<TaskField, string>>;

export type Task = TaskInput & {
  id: string;
  created_at: Date;
  updated_at: Date;
};

export function taskFieldErrors(error: z.ZodError): TaskFieldErrors {
  const out: TaskFieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as TaskField | undefined;
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

export const taskIdSchema = z.uuid();
