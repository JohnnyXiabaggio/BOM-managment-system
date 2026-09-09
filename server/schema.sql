-- PLM demo schema — VP2 product structure, change requests, and an
-- activity log so the app's workflow (submit -> review -> approve/reject)
-- is fully backed by MySQL instead of in-memory state.

CREATE TABLE IF NOT EXISTS items (
  id              VARCHAR(20)  NOT NULL PRIMARY KEY,
  parent_id       VARCHAR(20)  NULL,
  find_no         VARCHAR(10)  NOT NULL DEFAULT '',
  part_number     VARCHAR(20)  NOT NULL,
  revision        VARCHAR(5)   NOT NULL,
  name            VARCHAR(120) NOT NULL,
  kind            ENUM('asm','part') NOT NULL,
  qty             DECIMAL(10,3) NOT NULL,
  uom             VARCHAR(10)  NOT NULL,
  make_buy        ENUM('Make','Buy') NOT NULL,
  mass_kg         DECIMAL(10,3) NOT NULL,
  unit_cost       DECIMAL(10,2) NOT NULL DEFAULT 0,
  lifecycle_state ENUM('rel','wip','rev','obs') NOT NULL,
  effective_date  DATE NULL,
  owner           VARCHAR(80)  NOT NULL,
  classification  VARCHAR(120) NOT NULL,
  plant           VARCHAR(80)  NOT NULL,
  supplier        VARCHAR(120) NOT NULL,
  CONSTRAINT fk_items_parent FOREIGN KEY (parent_id) REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_items_parent ON items(parent_id);

CREATE TABLE IF NOT EXISTS revision_history (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  item_id     VARCHAR(20) NOT NULL,
  happened_on DATE NOT NULL,
  what        VARCHAR(200) NOT NULL,
  who         VARCHAR(80) NOT NULL,
  CONSTRAINT fk_history_item FOREIGN KEY (item_id) REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_history_item ON revision_history(item_id, happened_on);

CREATE TABLE IF NOT EXISTS change_requests (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  eco_number   VARCHAR(20)  NOT NULL UNIQUE,
  title        VARCHAR(200) NOT NULL,
  description  TEXT NULL,
  item_id      VARCHAR(20)  NOT NULL,
  priority     ENUM('Low','Normal','High','Urgent') NOT NULL DEFAULT 'Normal',
  status       ENUM('submitted','approved','rejected') NOT NULL DEFAULT 'submitted',
  submitted_by VARCHAR(80)  NOT NULL,
  submitted_at DATETIME     NOT NULL,
  decided_by   VARCHAR(80)  NULL,
  decided_at   DATETIME     NULL,
  CONSTRAINT fk_cr_item FOREIGN KEY (item_id) REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS activity_log (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  happened_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor             VARCHAR(80) NOT NULL,
  action            VARCHAR(40) NOT NULL,
  item_id           VARCHAR(20) NULL,
  change_request_id INT NULL,
  detail            VARCHAR(300) NOT NULL,
  CONSTRAINT fk_activity_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_activity_cr FOREIGN KEY (change_request_id) REFERENCES change_requests(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_activity_time ON activity_log(happened_at);
