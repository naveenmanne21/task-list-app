export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="loading">
      <span className="spinner" aria-hidden="true" />
      Loading tasks…
    </div>
  );
}
