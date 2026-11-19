-- FlowDesk schema (PostgreSQL 14+)
-- Multi-tenant: every tenant-owned row carries org_id, every query filters by it,
-- and composite indexes start with org_id so per-tenant queries stay fast.
-- Flexible data (custom field values, dependencies, approval history) uses JSONB.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  color         TEXT NOT NULL DEFAULT '#6d5dfc',
  password_hash TEXT NOT NULL,
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,      -- SHA-256 of the token; the raw token is never stored
  expires_at  BIGINT NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS orgs (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  key_prefix     TEXT NOT NULL,
  task_seq       INTEGER NOT NULL DEFAULT 0,
  capacity       INTEGER NOT NULL DEFAULT 5,
  approval_chain JSONB NOT NULL DEFAULT '[]',
  integrations   JSONB NOT NULL DEFAULT '{}',
  github_secret  TEXT NOT NULL,          -- verifies incoming GitHub webhook signatures
  calendar_token TEXT NOT NULL,          -- unguessable token for the .ics subscription feed
  created_at     BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  org_id    TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);

CREATE TABLE IF NOT EXISTS invitations (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  invited_by TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(org_id, status);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#6d5dfc',
  deadline    TEXT,
  archived    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id);

CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  key             TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL CHECK (status IN ('todo', 'progress', 'review', 'done')),
  priority        TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  assignee_id     TEXT REFERENCES users(id),
  due_date        TEXT,
  estimate        INTEGER NOT NULL DEFAULT 0,
  blocked_by      JSONB NOT NULL DEFAULT '[]',
  parent_id       TEXT,
  custom_fields   JSONB NOT NULL DEFAULT '{}',
  recurrence      JSONB,
  recurrence_of   TEXT,
  approval        JSONB NOT NULL DEFAULT '{"status":"none","step":0,"history":[]}',
  links           JSONB NOT NULL DEFAULT '[]',
  time_spent      INTEGER NOT NULL DEFAULT 0,
  overdue_notified_on TEXT,
  created_by      TEXT NOT NULL,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  completed_at    BIGINT,
  version         INTEGER NOT NULL DEFAULT 1   -- optimistic concurrency control
);
CREATE INDEX IF NOT EXISTS idx_tasks_org_status ON tasks(org_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_org_project ON tasks(org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org_assignee ON tasks(org_id, assignee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_org_key ON tasks(org_id, key);

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL,
  body        TEXT NOT NULL,
  mentions    JSONB NOT NULL DEFAULT '[]',
  attachments JSONB NOT NULL DEFAULT '[]',
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(org_id, task_id);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  type       TEXT NOT NULL,
  date       TEXT NOT NULL,
  project_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_org_date ON events(org_id, date);

CREATE TABLE IF NOT EXISTS field_defs (
  id       TEXT NOT NULL,
  org_id   TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL,
  options  JSONB NOT NULL DEFAULT '[]',
  required BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (org_id, id)
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  trigger     JSONB NOT NULL,
  conditions  JSONB NOT NULL DEFAULT '[]',
  actions     JSONB NOT NULL,
  runs        INTEGER NOT NULL DEFAULT 0,
  last_run_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_rules_org ON automation_rules(org_id);

CREATE TABLE IF NOT EXISTS automation_runs (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  rule_id    TEXT NOT NULL,
  rule_name  TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subject    TEXT,
  actions    JSONB NOT NULL DEFAULT '[]',
  status     TEXT NOT NULL,
  error      TEXT,
  at         BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_org_at ON automation_runs(org_id, at);

CREATE TABLE IF NOT EXISTS webhooks (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  events     JSONB NOT NULL,
  secret     TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  webhook_id TEXT NOT NULL,
  url        TEXT NOT NULL,
  event      TEXT NOT NULL,
  status     INTEGER NOT NULL,
  ok         BOOLEAN NOT NULL,
  signature  TEXT,
  body       TEXT NOT NULL,
  at         BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliveries_org_at ON webhook_deliveries(org_id, at);

-- Background jobs: a worker claims a job with an atomic conditional UPDATE (status='queued' → 'running'),
-- so several workers can share the queue without ever running the same job twice.
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  org_id      TEXT,
  type        TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  priority    INTEGER NOT NULL DEFAULT 5,
  status      TEXT NOT NULL,              -- queued | running | done | dead
  attempts    INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 4,
  run_at      BIGINT NOT NULL,
  last_error  TEXT,
  result      TEXT,
  created_at  BIGINT NOT NULL,
  started_at  BIGINT,
  finished_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(status, priority, run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_org ON jobs(org_id, status);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  link       JSONB,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(org_id, user_id, read);

-- Append-only audit trail with before/after snapshots (enables restore)
CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  actor_label   TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  before        JSONB,
  after         JSONB,
  summary       TEXT NOT NULL,
  via_automation BOOLEAN NOT NULL DEFAULT FALSE,
  at            BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_org_at ON audit_logs(org_id, at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(org_id, entity_id);

CREATE TABLE IF NOT EXISTS docs (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id TEXT,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  version    INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_versions (
  id      TEXT PRIMARY KEY,
  org_id  TEXT NOT NULL,
  doc_id  TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  by      TEXT NOT NULL,
  at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_versions ON doc_versions(org_id, doc_id);

CREATE TABLE IF NOT EXISTS saved_searches (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  query      TEXT NOT NULL DEFAULT '',
  filters    JSONB NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_stats (
  org_id  TEXT NOT NULL,
  user_id TEXT NOT NULL,
  stats   JSONB NOT NULL,
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS outbox (
  id      TEXT PRIMARY KEY,
  org_id  TEXT NOT NULL,
  to_list JSONB NOT NULL,
  subject TEXT NOT NULL,
  summary TEXT NOT NULL,
  lines   JSONB NOT NULL DEFAULT '[]',
  at      BIGINT NOT NULL
);
