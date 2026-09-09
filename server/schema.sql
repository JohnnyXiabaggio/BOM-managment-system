-- PLM demo schema (SQLite) — VP2 product structure, change requests, and
-- an activity log so the app's workflow (submit -> review -> approve/
-- reject) is fully backed by a real database instead of in-memory state.
-- No server to install or configure: this is a single file on disk.

CREATE TABLE IF NOT EXISTS items (
  id              TEXT PRIMARY KEY,
  parent_id       TEXT NULL REFERENCES items(id),
  find_no         TEXT NOT NULL DEFAULT '',
  part_number     TEXT NOT NULL,
  revision        TEXT NOT NULL,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('asm','part')),
  qty             REAL NOT NULL,
  uom             TEXT NOT NULL,
  make_buy        TEXT NOT NULL CHECK (make_buy IN ('Make','Buy')),
  mass_kg         REAL NOT NULL,
  unit_cost       REAL NOT NULL DEFAULT 0,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('rel','wip','rev','obs')),
  effective_date  TEXT NULL,
  owner           TEXT NOT NULL,
  classification  TEXT NOT NULL,
  plant           TEXT NOT NULL,
  supplier        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id);

CREATE TABLE IF NOT EXISTS revision_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     TEXT NOT NULL REFERENCES items(id),
  happened_on TEXT NOT NULL,
  what        TEXT NOT NULL,
  who         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_item ON revision_history(item_id, happened_on);

CREATE TABLE IF NOT EXISTS change_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  eco_number   TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  description  TEXT NULL,
  item_id      TEXT NOT NULL REFERENCES items(id),
  priority     TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low','Normal','High','Urgent')),
  status       TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected')),
  submitted_by TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  decided_by   TEXT NULL,
  decided_at   TEXT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  happened_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
  actor             TEXT NOT NULL,
  action            TEXT NOT NULL,
  item_id           TEXT NULL REFERENCES items(id),
  change_request_id INTEGER NULL REFERENCES change_requests(id),
  detail            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(happened_at);
