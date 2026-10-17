import Link from "next/link";
import { ImportForm } from "@/components/ImportForm";
import { requireUser } from "@/lib/auth/getCurrentUser";
import { MAX_ROWS } from "@/lib/import/service";

export default async function ImportPage() {
  await requireUser();
  return (
    <>
      <div className="page-header">
        <h1>Import tasks from CSV</h1>
        <Link href="/tasks">Back to tasks</Link>
      </div>
      <div className="help">
        <p>
          The first row must be a header with the columns <code>title</code>, <code>due_date</code> and{" "}
          <code>priority</code>, and optionally <code>notes</code>.
        </p>
        <ul>
          <li>title: required, up to 200 characters</li>
          <li>due_date: a real date written as YYYY-MM-DD</li>
          <li>priority: a whole number from 1 (highest) to 5</li>
        </ul>
        <p className="muted">
          Valid rows are imported together; every other row is listed with the reason. Blank rows are skipped. A
          task with the same title and due date as another row or an existing task is a duplicate. Up to 1 MB and{" "}
          {MAX_ROWS} rows.
        </p>
      </div>
      <ImportForm />
    </>
  );
}
