import { TaskForm } from "@/components/TaskForm";
import { requireUser } from "@/lib/auth/getCurrentUser";
import { createTaskAction } from "../actions";

export default async function NewTaskPage() {
  await requireUser();
  return (
    <>
      <h1>New task</h1>
      <TaskForm action={createTaskAction} submitLabel="Create task" />
    </>
  );
}
