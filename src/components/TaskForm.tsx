"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { TaskFormState, TaskFormValues } from "@/app/tasks/actions";
import { STATUS_LABELS, STATUSES } from "@/lib/tasks/schema";

type Props = {
  action: (prev: TaskFormState, formData: FormData) => Promise<TaskFormState>;
  initial?: Partial<TaskFormValues>;
  submitLabel: string;
};

const PRIORITIES = [1, 2, 3, 4, 5];

export function TaskForm({ action, initial = {}, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  // After a failed submit, show what the user typed (React resets the form).
  const v = { ...initial, ...state.values };
  const err = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="stack task-form" noValidate>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}

      <label className="field">
        Title
        <input name="title" required defaultValue={v.title} aria-invalid={!!err.title} />
        {err.title && <span className="field-error">{err.title}</span>}
      </label>

      <div className="form-row">
        <label className="field">
          Due date
          <input name="due_date" type="date" required defaultValue={v.due_date} aria-invalid={!!err.due_date} />
          {err.due_date && <span className="field-error">{err.due_date}</span>}
        </label>

        <label className="field">
          Priority
          <select name="priority" required defaultValue={v.priority ?? "3"} aria-invalid={!!err.priority}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
                {p === 1 ? " (highest)" : p === 5 ? " (lowest)" : ""}
              </option>
            ))}
          </select>
          {err.priority && <span className="field-error">{err.priority}</span>}
        </label>

        <label className="field">
          Status
          <select name="status" defaultValue={v.status ?? "todo"} aria-invalid={!!err.status}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {err.status && <span className="field-error">{err.status}</span>}
        </label>
      </div>

      <label className="field">
        Notes <span className="muted">(optional)</span>
        <textarea name="notes" rows={4} defaultValue={v.notes ?? ""} aria-invalid={!!err.notes} />
        {err.notes && <span className="field-error">{err.notes}</span>}
      </label>

      <div className="form-actions">
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link href="/tasks">Cancel</Link>
      </div>
    </form>
  );
}
