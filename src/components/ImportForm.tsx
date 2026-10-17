"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { buildRejectedCsv } from "@/lib/import/rejectedCsv";
import type { ImportResult } from "@/lib/import/service";

type State =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "done"; result: ImportResult; fileName: string }
  | { status: "error"; error: string; signedOut?: boolean };

export function ImportForm() {
  const [state, setState] = useState<State>({ status: "idle" });
  const uploading = state.status === "uploading";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setState({ status: "error", error: "Choose a CSV file to upload." });
      return;
    }

    setState({ status: "uploading" });
    try {
      const res = await fetch("/api/import", { method: "POST", body: formData });
      const body = await res.json().catch(() => null);
      if (res.ok && body) {
        setState({ status: "done", result: body as ImportResult, fileName: file.name });
      } else {
        setState({
          status: "error",
          error: body?.error ?? `The import failed (HTTP ${res.status}). No tasks were imported.`,
          signedOut: res.status === 401,
        });
      }
    } catch {
      setState({ status: "error", error: "Could not reach the server. Check your connection and try again." });
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="import-form" aria-busy={uploading}>
        <label className="field">
          CSV file
          <input type="file" name="file" accept=".csv,text/csv" required disabled={uploading} />
        </label>
        <button type="submit" disabled={uploading}>
          {uploading ? "Importing…" : "Import"}
        </button>
      </form>

      {uploading && (
        <p role="status" className="loading">
          <span className="spinner" aria-hidden="true" />
          Checking and importing rows…
        </p>
      )}

      {state.status === "error" && (
        <div role="alert" className="error">
          <strong>Nothing was imported.</strong> {state.error}{" "}
          {state.signedOut && <Link href="/login">Sign in again</Link>}
        </div>
      )}

      {state.status === "done" && <ImportSummary result={state.result} fileName={state.fileName} />}
    </>
  );
}

function ImportSummary({ result, fileName }: { result: ImportResult; fileName: string }) {
  const { imported, skippedBlank, totalRows, rejected } = result;

  function downloadRejected() {
    // BOM so Excel opens the UTF-8 file correctly; our own parser strips it.
    const blob = new Blob(["﻿" + buildRejectedCsv(rejected)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(/\.csv$/i, "") || "import"}-rejected.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="import-result" aria-live="polite">
      <h2>Import finished</h2>
      <p className="muted">
        {fileName}: {totalRows} data row{totalRows === 1 ? "" : "s"}
      </p>
      <dl className="summary">
        <div className="summary-item ok">
          <dt>Imported</dt>
          <dd>{imported}</dd>
        </div>
        <div className="summary-item">
          <dt>Skipped (blank)</dt>
          <dd>{skippedBlank}</dd>
        </div>
        <div className={`summary-item ${rejected.length ? "bad" : ""}`}>
          <dt>Rejected</dt>
          <dd>{rejected.length}</dd>
        </div>
      </dl>

      <div className="form-actions">
        {imported > 0 && (
          <Link href="/tasks" className="button-link primary">
            View tasks
          </Link>
        )}
        {rejected.length > 0 && (
          <button type="button" className="secondary" onClick={downloadRejected}>
            Download rejected rows
          </button>
        )}
      </div>

      {rejected.length > 0 && (
        <div className="table-wrap">
          <table className="rejected-table">
            <caption>Rejected rows (row numbers count the header as row 1)</caption>
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Reason</th>
                <th scope="col">Title</th>
                <th scope="col">Due date</th>
                <th scope="col">Priority</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rejected.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td className="reason">{r.reason}</td>
                  <td className="cell-clip" title={r.data.title}>
                    {r.data.title}
                  </td>
                  <td>{r.data.due_date}</td>
                  <td>{r.data.priority}</td>
                  <td className="cell-clip" title={r.data.notes}>
                    {r.data.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
