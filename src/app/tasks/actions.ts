"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/getCurrentUser";
import { withUser } from "@/lib/db/withUser";
import {
  createTask,
  isUniqueViolation,
  setTaskStatus,
  softDeleteTask,
  updateTask,
} from "@/lib/tasks/queries";
import {
  DUPLICATE_TASK,
  taskFieldErrors,
  taskIdSchema,
  taskInputSchema,
  type Status,
  type TaskFieldErrors,
  type TaskInput,
} from "@/lib/tasks/schema";

export type TaskFormValues = Record<"title" | "due_date" | "priority" | "notes" | "status", string>;
export type TaskFormState = { error?: string; fieldErrors?: TaskFieldErrors; values?: TaskFormValues };

function formValues(formData: FormData): TaskFormValues {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : "";
  };
  return {
    title: get("title"),
    due_date: get("due_date"),
    priority: get("priority"),
    notes: get("notes"),
    status: get("status") || "todo",
  };
}

function parseId(id: unknown): string {
  const parsed = taskIdSchema.safeParse(id);
  if (!parsed.success) notFound();
  return parsed.data;
}

/**
 * Validates the form, runs `write` as the current user, and maps a duplicate
 * (unique violation on title + due date) to a form error.
 */
async function saveTask(
  formData: FormData,
  write: (userId: string, input: TaskInput) => Promise<boolean>,
): Promise<TaskFormState> {
  const user = await requireUser();
  const values = formValues(formData);
  const parsed = taskInputSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: taskFieldErrors(parsed.error), values };

  let found: boolean;
  try {
    found = await write(user.id, parsed.data);
  } catch (err) {
    if (isUniqueViolation(err)) return { fieldErrors: { title: DUPLICATE_TASK }, values };
    throw err;
  }
  if (!found) notFound();

  revalidatePath("/tasks");
  redirect("/tasks"); // throws; must stay outside the try/catch
}

export async function createTaskAction(_prev: TaskFormState, formData: FormData): Promise<TaskFormState> {
  return saveTask(formData, async (userId, input) => {
    await withUser(userId, (c) => createTask(c, input));
    return true;
  });
}

export async function updateTaskAction(id: string, _prev: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const taskId = parseId(id);
  return saveTask(formData, async (userId, input) =>
    Boolean(await withUser(userId, (c) => updateTask(c, taskId, input))),
  );
}

async function changeStatus(id: string, status: Status): Promise<void> {
  const user = await requireUser();
  const taskId = parseId(id);
  const found = await withUser(user.id, (c) => setTaskStatus(c, taskId, status));
  if (!found) notFound();
  revalidatePath("/tasks");
}

export async function completeTaskAction(id: string): Promise<void> {
  await changeStatus(id, "done");
}

export async function reopenTaskAction(id: string): Promise<void> {
  await changeStatus(id, "todo");
}

export async function deleteTaskAction(id: string): Promise<void> {
  const user = await requireUser();
  const taskId = parseId(id);
  const found = await withUser(user.id, (c) => softDeleteTask(c, taskId));
  if (!found) notFound();
  revalidatePath("/tasks");
}
