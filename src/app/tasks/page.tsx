import Link from "next/link";
import { TaskList } from "@/components/TaskList";
import { requireUser } from "@/lib/auth/getCurrentUser";
import { withUser } from "@/lib/db/withUser";
import { listTasks } from "@/lib/tasks/queries";

export default async function TasksPage() {
  const user = await requireUser();
  const { tasks, today } = await withUser(user.id, async (c) => ({
    tasks: await listTasks(c),
    // "Overdue" is relative to the database's current_date, the same date the filter uses.
    today: (await c.query<{ d: string }>("SELECT current_date::text AS d")).rows[0].d,
  }));

  return (
    <>
      <div className="page-header">
        <h1>Tasks</h1>
        <Link href="/tasks/new" className="button-link primary">
          New task
        </Link>
      </div>
      {tasks.length === 0 ? <p>No tasks yet.</p> : <TaskList tasks={tasks} today={today} />}
    </>
  );
}
