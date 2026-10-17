import { requireUser } from "@/lib/auth/getCurrentUser";
import { withUser } from "@/lib/db/withUser";

// Placeholder until the task list (step 4): proves the auth -> withUser path.
export default async function TasksPage() {
  const user = await requireUser();
  const count = await withUser(user.id, async (c) => {
    const { rows } = await c.query<{ n: number }>("SELECT count(*)::int AS n FROM tasks WHERE deleted_at IS NULL");
    return rows[0].n;
  });

  return (
    <>
      <h1>Tasks</h1>
      <p>You have {count} active task(s). The task list arrives in the next step.</p>
    </>
  );
}
