# Task List

A small task-list web app with CSV import. Next.js (App Router), TypeScript,
PostgreSQL in Docker, with per-user isolation enforced by Postgres row-level
security.

> Work in progress — this README is completed at the end.

## Requirements

- Node.js >= 20.12
- Docker (with Compose v2)

## Setup and run

```bash
cp .env.example .env   # local dev values only
npm install
npm run db:up          # Postgres 16 on localhost:5433
npm run db:migrate     # migrates the dev and test databases
npm run db:seed        # optional: demo users (below)
npm run dev            # http://localhost:3000
```

`npm run db:down` stops Postgres; `npm run db:reset` wipes and re-creates it.

### Demo users (demo only)

`npm run db:seed` creates two accounts so isolation between users is easy to
show. These passwords are public, for local demos only.

| Email             | Password          |
| ----------------- | ----------------- |
| alice@example.com | `alice-demo-pass` |
| bob@example.com   | `bob-demo-pass`   |

## Tests

```bash
npm run db:up   # tests need Postgres; they fail (not skip) without it
npm test
```

Tests run against a separate `tasks_test` database.

## How auth and isolation work

- Email + password accounts; passwords are hashed with bcrypt.
- A session is a random 32-byte token in an httpOnly, `SameSite=Lax` cookie
  (7 days, `Secure` in production). The database stores only its SHA-256 hash.
- `src/proxy.ts` only redirects to `/login` when there is no session cookie.
  The real check is `getCurrentUser()`, which looks up an unexpired session.
- The app connects as `app_user` (no superuser, no `BYPASSRLS`). Every task
  query runs through `withUser(user.id, …)`, which sets `app.user_id` for that
  transaction; RLS policies on `tasks` only expose that user's rows.
