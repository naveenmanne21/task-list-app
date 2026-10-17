import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { TaskFilters } from "@/components/TaskFilters";
import { TaskList } from "@/components/TaskList";
import { requireUser } from "@/lib/auth/getCurrentUser";
import { withUser } from "@/lib/db/withUser";
import { hasActiveFilters, parseFilters } from "@/lib/tasks/filters";
import { countActiveTasks, currentDate, listTasks } from "@/lib/tasks/queries";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function TasksPage({ searchParams }: Props) {
  const user = await requireUser();
  const filters = parseFilters(await searchParams);
  const active = hasActiveFilters(filters);

  const { tasks, total, today } = await withUser(user.id, async (c) => ({
    tasks: await listTasks(c, filters),
    total: await countActiveTasks(c),
    today: await currentDate(c),
  }));

  return (
    <>
      <div className="page-header">
        <h1>Tasks</h1>
        <Link href="/tasks/new" className="button-link primary">
          New task
        </Link>
      </div>

      {total > 0 && <TaskFilters filters={filters} active={active} />}

      {total === 0 ? (
        <EmptyState variant="no-tasks" />
      ) : tasks.length === 0 ? (
        <EmptyState variant="no-matches" />
      ) : (
        <>
          <p className="muted result-count">
            {active ? `Showing ${tasks.length} of ${total} tasks` : `${total} task${total === 1 ? "" : "s"}`}
          </p>
          <TaskList tasks={tasks} today={today} />
        </>
      )}
    </>
  );
}
