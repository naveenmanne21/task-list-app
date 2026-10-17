"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { completeTaskAction, deleteTaskAction, reopenTaskAction } from "@/app/tasks/actions";
import type { Status } from "@/lib/tasks/schema";

function PendingButton({ label, pendingLabel, className }: { label: string; pendingLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export function TaskActions({ id, title, status }: { id: string; title: string; status: Status }) {
  return (
    <div className="task-actions">
      {status === "done" ? (
        <form action={reopenTaskAction.bind(null, id)}>
          <PendingButton label="Reopen" pendingLabel="Reopening…" className="secondary" />
        </form>
      ) : (
        <form action={completeTaskAction.bind(null, id)}>
          <PendingButton label="Complete" pendingLabel="Completing…" className="secondary" />
        </form>
      )}
      <Link href={`/tasks/${id}/edit`} className="button-link">
        Edit
      </Link>
      <form
        action={deleteTaskAction.bind(null, id)}
        onSubmit={(e) => {
          if (!window.confirm(`Delete "${title}"?`)) e.preventDefault();
        }}
      >
        <PendingButton label="Delete" pendingLabel="Deleting…" className="danger" />
      </form>
    </div>
  );
}
