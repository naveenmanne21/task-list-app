-- 0001: the restricted runtime role, and the auth tables.
--
-- Roles are cluster-wide but this migration runs once per database (tasks and
-- tasks_test), so role creation must be idempotent. The password comes from
-- DATABASE_URL via the session setting app.app_user_password, which
-- scripts/migrate.ts sets before running migrations.

DO $$
DECLARE
  pw text := current_setting('app.app_user_password'); -- errors if unset
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE format(
      'CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L',
      pw);
  ELSE
    -- Re-assert the attributes so a pre-existing role can't be more privileged.
    EXECUTE format(
      'ALTER ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L',
      pw);
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;

-- users / sessions are not under RLS: login has to look a user up by email
-- before any identity is known. app_user gets only the privileges auth needs.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL CHECK (email = lower(email) AND char_length(email) <= 320),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

CREATE TABLE sessions (
  id         text PRIMARY KEY, -- sha256 hex of the cookie token; raw token is never stored
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

GRANT SELECT, INSERT ON users TO app_user;
GRANT SELECT, INSERT, DELETE ON sessions TO app_user;
