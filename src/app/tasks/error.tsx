"use client";

export default function TasksError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="error-state">
      <h2>Something went wrong</h2>
      <p>We couldn&apos;t load or update your tasks. Please try again.</p>
      {error.digest && <p className="muted">Reference: {error.digest}</p>}
      <button type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
