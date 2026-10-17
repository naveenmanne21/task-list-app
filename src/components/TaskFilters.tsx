import Link from "next/link";
import type { TaskFilters as Filters } from "@/lib/tasks/filters";
import { STATUS_LABELS, STATUSES } from "@/lib/tasks/schema";

// A plain GET form: filters live in the URL, so they survive reloads and can be shared.
export function TaskFilters({ filters, active }: { filters: Filters; active: boolean }) {
  return (
    <form method="get" action="/tasks" className="filters" role="search">
      <label className="field filter-search">
        Search
        <input type="search" name="q" placeholder="Title or notes" defaultValue={filters.q ?? ""} />
      </label>

      <label className="field">
        Status
        <select name="status" defaultValue={filters.status ?? ""}>
          <option value="">Any</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Priority
        <select name="priority" defaultValue={filters.priority ? String(filters.priority) : ""}>
          <option value="">Any</option>
          {[1, 2, 3, 4, 5].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <label className="checkbox">
        <input type="checkbox" name="overdue" value="1" defaultChecked={filters.overdue} />
        Overdue only
      </label>

      <div className="filter-actions">
        <button type="submit">Apply</button>
        {active && <Link href="/tasks">Clear filters</Link>}
      </div>
    </form>
  );
}
