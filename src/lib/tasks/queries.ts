// Task queries. Each takes the PoolClient handed out by withUser(), so it runs
// inside a transaction where RLS knows the current user; none of them can be
// called with the bare pool. Soft-deleted rows are always excluded here (the
// RLS policies deliberately check ownership only).
import type { PoolClient } from "pg";
import type { Status, Task, TaskInput } from "./schema";
import type { TaskFilters } from "./filters";

const COLUMNS = "id, title, notes, due_date, priority, status, created_at, updated_at";

/** Escapes LIKE wildcards so the term matches literally ("100%" is not "100 then anything"). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listTasks(client: PoolClient, filters: TaskFilters = {}): Promise<Task[]> {
  const where = ["deleted_at IS NULL"];
  const params: unknown[] = [];
  const param = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (filters.q) {
    const p = param(`%${escapeLike(filters.q)}%`);
    where.push(`(title ILIKE ${p} ESCAPE '\\' OR notes ILIKE ${p} ESCAPE '\\')`);
  }
  if (filters.status) where.push(`status = ${param(filters.status)}`);
  if (filters.priority) where.push(`priority = ${param(filters.priority)}`);
  if (filters.overdue) where.push("due_date < current_date AND status <> 'done'");

  const { rows } = await client.query<Task>(
    `SELECT ${COLUMNS} FROM tasks
      WHERE ${where.join(" AND ")}
      ORDER BY due_date ASC, priority ASC, created_at ASC`,
    params,
  );
  return rows;
}

/** Number of the user's active tasks, ignoring filters (tells "none yet" from "none match"). */
export async function countActiveTasks(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM tasks WHERE deleted_at IS NULL");
  return rows[0].n;
}

/** The database's current_date as YYYY-MM-DD: the same "today" the overdue filter uses. */
export async function currentDate(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ d: string }>("SELECT current_date::text AS d");
  return rows[0].d;
}

export async function getTask(client: PoolClient, id: string): Promise<Task | null> {
  const { rows } = await client.query<Task>(`SELECT ${COLUMNS} FROM tasks WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return rows[0] ?? null;
}

export async function createTask(client: PoolClient, input: TaskInput): Promise<Task> {
  const { rows } = await client.query<Task>(
    `INSERT INTO tasks (title, notes, due_date, priority, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [input.title, input.notes, input.due_date, input.priority, input.status],
  );
  return rows[0];
}

/** Returns the updated task, or null if it doesn't exist, is deleted, or isn't the user's. */
export async function updateTask(client: PoolClient, id: string, input: TaskInput): Promise<Task | null> {
  const { rows } = await client.query<Task>(
    `UPDATE tasks SET title = $2, notes = $3, due_date = $4, priority = $5, status = $6
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${COLUMNS}`,
    [id, input.title, input.notes, input.due_date, input.priority, input.status],
  );
  return rows[0] ?? null;
}

export async function setTaskStatus(client: PoolClient, id: string, status: Status): Promise<boolean> {
  const { rowCount } = await client.query("UPDATE tasks SET status = $2 WHERE id = $1 AND deleted_at IS NULL", [
    id,
    status,
  ]);
  return rowCount === 1;
}

export async function softDeleteTask(client: PoolClient, id: string): Promise<boolean> {
  const { rowCount } = await client.query("UPDATE tasks SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", [
    id,
  ]);
  return rowCount === 1;
}

export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}
