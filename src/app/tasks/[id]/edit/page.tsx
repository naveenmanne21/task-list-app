import { notFound } from "next/navigation";
import { TaskForm } from "@/components/TaskForm";
import { requireUser } from "@/lib/auth/getCurrentUser";
import { withUser } from "@/lib/db/withUser";
import { getTask } from "@/lib/tasks/queries";
import { taskIdSchema } from "@/lib/tasks/schema";
import { updateTaskAction } from "../../actions";

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!taskIdSchema.safeParse(id).success) notFound();

  // RLS: another user's task id simply isn't found.
  const task = await withUser(user.id, (c) => getTask(c, id));
  if (!task) notFound();

  return (
    <>
      <h1>Edit task</h1>
      <TaskForm
        action={updateTaskAction.bind(null, task.id)}
        submitLabel="Save changes"
        initial={{
          title: task.title,
          due_date: task.due_date,
          priority: String(task.priority),
          status: task.status,
          notes: task.notes ?? "",
        }}
      />
    </>
  );
}
