-- 0002: tasks, with row-level security keyed on the per-transaction app.user_id.

-- Current user for RLS. The app sets app.user_id with set_config(..., true)
-- (transaction-local). On a pooled connection after that transaction ends the
-- setting reads back as '' rather than NULL, and ''::uuid would raise, so
-- normalise '' to NULL. NULL never equals a user_id, so "no user" sees nothing.
CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

REVOKE ALL ON FUNCTION app_current_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_user_id() TO app_user;

CREATE TABLE tasks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL DEFAULT app_current_user_id() REFERENCES users (id),
  -- Titles are stored trimmed; char_length counts code points, matching the
  -- app's [...title].length check.
  title      text NOT NULL CHECK (title = btrim(title) AND char_length(title) BETWEEN 1 AND 200),
  notes      text,
  due_date   date NOT NULL,
  priority   smallint NOT NULL CHECK (priority BETWEEN 1 AND 5),
  status     text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz -- soft delete; NULL = active
);

-- Duplicate rule: same exact (trimmed) title + due date among a user's active
-- tasks. Soft-deleted tasks don't count. Also the ON CONFLICT target for import.
CREATE UNIQUE INDEX tasks_user_title_due_key
  ON tasks (user_id, title, due_date)
  WHERE deleted_at IS NULL;

CREATE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS. FORCE also applies it to the table owner (the superuser still bypasses,
-- which is why the app never connects as app_owner). Policies check only
-- ownership; deleted_at filtering is done in queries so that the soft-delete
-- UPDATE itself is not rejected by a policy.
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY tasks_select ON tasks FOR SELECT TO app_user
  USING (user_id = app_current_user_id());

CREATE POLICY tasks_insert ON tasks FOR INSERT TO app_user
  WITH CHECK (user_id = app_current_user_id());

CREATE POLICY tasks_update ON tasks FOR UPDATE TO app_user
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- No DELETE policy and no DELETE grant: hard deletes are impossible for the app.
-- UPDATE is limited to the editable columns (id, user_id, created_at are fixed).
GRANT SELECT, INSERT ON tasks TO app_user;
GRANT UPDATE (title, notes, due_date, priority, status, deleted_at) ON tasks TO app_user;
