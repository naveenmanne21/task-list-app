# Video

link - https://drive.google.com/file/d/1It5oPeaLKz5j8nu7C6nEzTsqbJlzZ8il/view?usp=sharing


# Task List

A task-list web app with CSV import. Each user signs in and sees only
their own tasks, and **PostgreSQL row-level security** enforces that, not just
the application code. Tasks have a title, notes, due date, priority (1–5) and
status. Users can create, edit, complete, reopen and soft-delete them, search
and filter the list, and bulk-import tasks from a CSV file. The import
validates every row and reports the rejected ones with a reason.

**Tech stack:** Next.js 16 (App Router, Server Actions), TypeScript,
PostgreSQL 16 in Docker, `pg` (node-postgres, plain SQL), zod, bcryptjs,
papaparse, vitest.

## Prerequisites

- **Node.js 20.12+**. 24 is recommended; see `.nvmrc` (`nvm use`).
- **Docker Desktop**, running (Compose v2). Postgres is published on
  `localhost:5433`, so it won't clash with a local Postgres on 5432.

## Quick start

```bash
cp .env.example .env    # local development values only
npm install
npm run db:up           # start Postgres 16 and wait until it is healthy
npm run db:migrate      # migrate the dev database and the test database
npm run db:seed         # create the two demo accounts below
npm run dev             # http://localhost:3000
```

### Demo accounts

These passwords are **for local demos only** and are public in this README.

| Email               | Password          |
| ------------------- | ----------------- |
| `alice@example.com` | `alice-demo-pass` |
| `bob@example.com`   | `bob-demo-pass`   |

You can also create an account at `/signup`.

### Other scripts

| Command              | What it does                                    |
| -------------------- | ----------------------------------------------- |
| `npm run db:down`    | Stop Postgres (data is kept in a Docker volume) |
| `npm run db:reset`   | Delete the volume, start fresh and migrate      |
| `npm run build`      | Production build                                |
| `npm start`          | Run the production build                        |
| `npm run typecheck`  | `tsc --noEmit`                                  |
| `npm run test:watch` | Vitest in watch mode                            |

## Running the tests

```bash
npm run db:up   # Docker must be running; tests use a real Postgres
npm test
```

Tests run against a separate `tasks_test` database in the same container. The
test setup migrates it automatically and refuses to run against any database
whose name doesn't end in `_test`. If Postgres is unreachable, `npm test`
**fails** with a message saying how to start it; it never skips tests.

Every assertion runs as the restricted `app_user` role, through the same
`withUser()` path the app uses. The owner role is used only to create users,
reset tables, and inspect rows behind RLS. There are 185 tests:

| Area                                        | File                                    |
| ------------------------------------------- | --------------------------------------- |
| RLS, grants, soft delete, unique index      | `tests/integration/rls.test.ts`         |
| Signup, login, sessions                     | `tests/integration/auth.test.ts`        |
| Task CRUD, duplicates, cross-user access    | `tests/integration/tasks.test.ts`       |
| List, search (incl. literal `%`), filters   | `tests/integration/task-list.test.ts`   |
| Import service: DB duplicates, atomicity    | `tests/integration/import.test.ts`      |
| The edge-case demo file, uploaded twice     | `tests/integration/edge-cases.test.ts`  |
| Task schema (lengths, priorities, dates)    | `tests/unit/task-schema.test.ts`        |
| CSV parse / validate / dedupe / rejected CSV | `tests/unit/import.test.ts`             |
| URL filter parsing, LIKE escaping           | `tests/unit/filters.test.ts`            |

## Design notes

### Row-level security

- **Two roles.** `app_owner` is the container's superuser. It owns the tables
  and is used only by migrations, the seed script and test setup. The app
  connects as **`app_user`**: `NOSUPERUSER NOBYPASSRLS`, not the table owner.
  Migration `0001` creates it idempotently, because roles are cluster-wide
  and the migration runs on both databases. Its password comes from
  `DATABASE_URL`, so no SQL file contains a password.
- **Current user.** `withUser(userId, fn)` takes a pooled connection and runs
  `BEGIN`, then `set_config('app.user_id', $1, true)`, then `fn(client)`, then
  `COMMIT`. On error it runs `ROLLBACK`, and it always releases the
  connection.
  - The setting is **transaction-local**, so it can't leak to the next request
    that reuses the connection.
  - Policies read it through `app_current_user_id()`, which is
    `nullif(current_setting('app.user_id', true), '')::uuid`. On a reused
    connection the setting reads back as `''`, not NULL, and `''::uuid` would
    throw. With no user, the function returns NULL, which matches no row, so
    the query sees nothing.
  - The same function is the default for `tasks.user_id`.
- **`FORCE ROW LEVEL SECURITY`** on `tasks`, with separate `SELECT`, `INSERT`
  and `UPDATE` policies on `user_id = app_current_user_id()`.
- **The policies check only `user_id`.** Soft-deleted rows are filtered out
  with `deleted_at IS NULL` in every query (`src/lib/tasks/queries.ts`). If
  the policies also hid deleted rows, the soft-delete `UPDATE` itself could be
  rejected, because the updated row would no longer pass the policy.
- **Soft delete only.** `app_user` has `SELECT` and `INSERT` on `tasks`, and
  `UPDATE` only on the editable columns. It has no `DELETE` grant and there's
  no `DELETE` policy, so a hard delete fails with "permission denied". Deleting
  a task sets `deleted_at`. `user_id` can't be changed, and `updated_at` is set
  by a trigger.
- **Every task query goes through `withUser`.** The query functions take the
  `PoolClient` that `withUser` provides, so they can't be called with the bare
  pool. Every Server Action, page and the import route call `requireUser()`
  first.
- **The `users` and `sessions` queries use the pool directly.** Login has to
  look a user up by email before any user is known, so these two tables
  aren't under RLS. `app_user` has only the privileges auth needs: no `UPDATE`
  on `users`, and `DELETE` on `sessions` only, for logout.

### Auth

- Email and password. Emails are stored lowercase, with a unique index on
  `lower(email)`. Passwords are hashed with bcrypt (cost 12) and limited to 72
  bytes, because bcrypt silently ignores anything longer.
- Login returns the same "Invalid email or password." for an unknown email and
  a wrong password. For an unknown email it still runs bcrypt against a dummy
  hash, so the response doesn't come back faster.
- A session is a random 32-byte token in an `httpOnly`, `SameSite=Lax` cookie.
  It lasts 7 days and is `Secure` in production. The database stores only
  **its SHA-256 hash**.
- `src/proxy.ts` (Next 16's replacement for `middleware.ts`) only redirects
  to `/login` when there's no session cookie. The real check is
  `getCurrentUser()`, which looks up an unexpired session on the server.

### CSV import

`POST /api/import` is a thin wrapper around `src/lib/import/service.ts`. The
parsing and validation in `src/lib/import/` are pure functions.

- **Format.** The file must be UTF-8 (a BOM is fine). It may use CRLF or LF
  line endings, and quoted fields may contain commas, `""` and line breaks.
  The header row is required. Headers are trimmed and lowercased, and columns
  can be in any order. `title`, `due_date` and `priority` are required;
  `notes` is optional and unknown columns are ignored. The limits are 1 MB and
  5,000 data rows.
- **Whole-file errors** reject the upload with one clear message: an empty
  file, a header with no data rows, a missing or repeated required column, an
  unterminated quote, invalid UTF-8, or a file over the limits.
- **Row rules** are the same zod schema the task form uses, so the CSV and the
  UI can't diverge:
  - The title is required and at most 200 characters after trimming. Length
    is counted in code points, matching Postgres `char_length`.
  - `due_date` must be a real calendar date written as `YYYY-MM-DD`.
  - `priority` must be a whole number 1–5 written as digits, so `high`, `3.5`,
    `0`, `6` and blank are all rejected.
  - Notes can be at most 10,000 characters.
  - Every problem in a row is reported, joined with `"; "`.
- **Row numbers** count the header as row 1, so the first data row is row 2.
  A quoted field that spans several lines is still one row. The line break at
  the end of the file doesn't count as a row.
- **Blank rows** (all cells empty or whitespace, including `,,,`) are skipped
  and counted, not rejected.
- **"Too many fields (check for an unquoted comma)"** is reported when a row
  has more cells than the header. It's the only reason given for that row,
  because the shifted values would produce misleading field errors. A row
  with *fewer* cells has the missing ones treated as empty, and validation
  reports them.
- **Duplicates.** A task is a duplicate if it has the same trimmed title
  (case-sensitive) and the same due date as an active task.
  - **Within the file:** the first *valid* occurrence wins, and later ones are
    rejected as "Duplicate of row N". If the first occurrence was invalid, the
    next valid row is not a duplicate.
  - **In the account:** all valid rows are inserted in **one transaction**
    with a single `INSERT … SELECT FROM jsonb_to_recordset(…) ON CONFLICT
    (user_id, title, due_date) WHERE deleted_at IS NULL DO NOTHING RETURNING
    title, due_date`. Valid rows that weren't returned are matched back to
    their row numbers by `(title, due_date)`, not by position, and reported as
    "Duplicate of existing task". The partial unique index also protects
    against two imports running at once. Any database error rolls back the
    whole import and returns a clean error.
- **Rejected-rows CSV.** It's built in the browser with the columns
  `title,due_date,priority,notes,row_number,reason`. It uses RFC 4180 quoting
  and CRLF line endings, and starts with a UTF-8 BOM for Excel. Cells that
  start with `=`, `+`, `-` or `@` get a leading `'` so spreadsheet apps don't
  run them as formulas. The file can be re-imported after it's fixed.

### Project layout

```
db/migrations/       0001 roles + auth tables, 0002 tasks + RLS
scripts/             migrate.ts, seed.ts, env.ts (.env loader for non-Next code)
src/proxy.ts         cookie-presence redirect for /tasks and /import
src/app/             pages, Server Actions, /api/import route
src/components/      forms, list, filters, empty state, import UI
src/lib/db/          pool.ts, withUser.ts
src/lib/auth/        password hashing, sessions, getCurrentUser
src/lib/tasks/       schema (shared validation), queries, filters
src/lib/import/      parse, validate, dedupe, rejectedCsv, analyze, service
tests/               unit/ (no DB) and integration/ (test DB as app_user)
fixtures/            edge-cases.csv (the demo file)
```

## Assumptions and decisions

- **Priority 1 is the highest.** The list sorts by due date, then priority
  1→5.
- **Duplicate titles match exactly**: trimmed but case-sensitive, so
  "Pay rent" and "pay rent" are different tasks. Titles are stored trimmed.
- **Soft-deleted tasks don't count as duplicates**, so you can re-create or
  re-import a task you deleted.
- **The due date is required** everywhere: the form, the CSV and the database.
- **Notes are capped at 10,000 characters**, with their own rejection reason.
  The brief doesn't ask for this limit.
- **"Overdue" uses the database's `current_date`**, which is UTC in the
  container. Overdue means a due date before today and a status other than
  done.
- **Status** is one of `todo`, `in_progress` or `done`. Complete sets `done`
  and Reopen sets `todo`.
- **`src/proxy.ts`** is used because Next 16 renamed `middleware.ts` to
  `proxy.ts`.
- **Search** is a case-insensitive `ILIKE` over title and notes, with `%`, `_`
  and `\` escaped, so `100%` matches literally.

## Edge-case demo

`fixtures/edge-cases.csv` uses Windows line endings. The header is row 1.

| Row | Content                                         | Expected outcome                                                  |
| --: | ----------------------------------------------- | ----------------------------------------------------------------- |
|   2 | `Buy groceries` with `"Milk, eggs, and bread"`  | Imported (quoted commas kept)                                     |
|   3 | `Pay rent,2026-11-01,1`                         | Imported                                                          |
|   4 | empty line                                      | Skipped (blank)                                                   |
|   5 | `Call plumber`, priority `high`                 | Rejected: Priority must be a whole number from 1 to 5             |
|   6 | 201-character title                             | Rejected: Title must be at most 200 characters                    |
|   7 | `Pay rent,2026-11-01,3` (same as row 3)         | Rejected: Duplicate of row 3                                      |
|   8 | `Book dentist`, due `2026-02-30`                | Rejected: Due date must be a real date in YYYY-MM-DD format       |
|   9 | `,,,`                                           | Skipped (blank)                                                   |
|  10 | `Plan trip` with `"She said ""go"", so we go"`  | Imported (escaped quotes and a comma kept)                        |
|  11 | `Renew passport,2026-12-01,5` (no notes cell)   | Imported                                                          |
|  12 | `Fix bike,…,needs chain,and brakes`             | Rejected: Too many fields (check for an unquoted comma)           |

**Demo:**

1. Sign in as alice and open **Import CSV**. Upload
   `fixtures/edge-cases.csv`. Result: **4 imported, 2 blank rows skipped, 5
   rejected**, each with its row number and reason. Then click **Download
   rejected rows**.
2. Upload the same file again. Result: **0 imported**. Rows 2, 3, 10 and 11
   are now rejected as "Duplicate of existing task", and rows 5, 6, 7, 8 and
   12 keep their original reasons.
3. Optional: sign in as bob. His task list is empty, and importing the same
   file works for him.

`tests/integration/edge-cases.test.ts` asserts exactly this.

## What I would do next

- **Login rate limiting.** Add per-IP and per-account throttling and lockout
  on failed logins.
- **CSRF review.** Server Actions check `Origin`, and the session cookie is
  `SameSite=Lax`. I'd confirm the same holds for `/api/import` behind a proxy
  or CDN, or add an explicit token.
- **Password reset** and email verification.
- **Pagination** for the task list (keyset on due date, priority and id).
- **Time zones for "overdue".** Store the user's time zone and compare
  against their local date instead of UTC.
- **Streaming parse for large files**, so imports bigger than 1 MB don't need
  to be held in memory, with progress reporting.
- **CI.** Run typecheck, build and `npm test` in a GitHub Actions workflow
  with a Postgres service container.
- **Playwright end-to-end tests** for the browser-only parts: the delete
  confirm, pending states, and the file download.
- **Expired-session cleanup.** Run a periodic `DELETE FROM sessions WHERE
  expires_at < now()`. Rotating a session on login would also help.

## How I used AI

I built this with Claude Code (in VS Code) as a pair programmer. I had it read
the brief and propose a plan and folder structure before any code was
written. I then changed the plan: I chose Postgres in Docker over Supabase,
and specified the role setup, the `app_current_user_id()` empty-string fix,
exact-title duplicates, and the test-connection rules. After that I had it
build one step at a time, with a commit per step. At each step I reviewed the
code and the reasoning, asked for RLS tests before any auth code, and ran or
checked the results myself; it also verified against the running app.
`ai-log/` contains the complete, unedited transcripts of these sessions.

