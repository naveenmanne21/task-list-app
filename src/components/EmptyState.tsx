import Link from "next/link";

export function EmptyState({ variant }: { variant: "no-tasks" | "no-matches" }) {
  if (variant === "no-matches") {
    return (
      <div className="empty-state">
        <h2>No tasks match your filters</h2>
        <p>Try a different search or fewer filters.</p>
        <Link href="/tasks">Clear filters</Link>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <h2>No tasks yet</h2>
      <p>Create your first task, or import a CSV file.</p>
      <div className="empty-actions">
        <Link href="/tasks/new" className="button-link primary">
          New task
        </Link>
        <Link href="/import" className="button-link">
          Import CSV
        </Link>
      </div>
    </div>
  );
}
