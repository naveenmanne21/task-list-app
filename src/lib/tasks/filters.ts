// List filters, read from and written to URL search params. Invalid values are
// dropped rather than erroring, so a hand-edited URL still renders a list.
import { parsePriority, STATUSES, type Status } from "./schema";

export type TaskFilters = {
  q?: string;
  status?: Status;
  priority?: number;
  overdue?: boolean;
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseFilters(params: SearchParams): TaskFilters {
  const filters: TaskFilters = {};
  const q = first(params.q)?.trim();
  if (q) filters.q = q.slice(0, 200);
  const status = first(params.status);
  if (status && (STATUSES as readonly string[]).includes(status)) filters.status = status as Status;
  const priority = parsePriority(first(params.priority) ?? "");
  if (priority !== null) filters.priority = priority;
  if (first(params.overdue) === "1") filters.overdue = true;
  return filters;
}

export function hasActiveFilters(f: TaskFilters): boolean {
  return Boolean(f.q || f.status || f.priority || f.overdue);
}
