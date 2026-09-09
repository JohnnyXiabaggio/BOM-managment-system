# Running the MySQL-backed demo

The Structure Explorer's product data, change requests, and activity log
are all persisted in MySQL — nothing is held only in browser memory. This
is what you need to run it locally.

## 1. Install and start MySQL

Any MySQL 8.x server works. On Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y mysql-server
sudo service mysql start   # or: sudo mysqld_safe &
```

## 2. Create the database and app user

```bash
mysql -u root <<'SQL'
CREATE DATABASE IF NOT EXISTS plm_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'plm_app'@'localhost' IDENTIFIED WITH mysql_native_password BY 'plm_app_pw';
GRANT ALL PRIVILEGES ON plm_demo.* TO 'plm_app'@'localhost';
FLUSH PRIVILEGES;
SQL
```

(Use your own password and update `.env` accordingly if you'd rather not
use the demo credentials above.)

## 3. Configure environment variables

```bash
cp .env.example .env
```

The defaults match step 2. Edit `.env` if you used different credentials
or ports.

## 4. Install dependencies, migrate, and seed

```bash
npm install
npm run db:migrate   # creates items / revision_history / change_requests / activity_log
npm run db:seed      # loads the VP2 product structure + revision history
```

`db:seed` truncates and reloads the demo tables, so it's safe to re-run
whenever you want to reset the workflow back to a clean state (e.g. after
submitting and approving change requests during a demo).

## 5. Run it

Two processes: the Express API (MySQL client) and the Vite dev server
(proxies `/api/*` to the API).

```bash
npm run dev:full
```

This runs both concurrently. Open the URL Vite prints (usually
`http://localhost:5173/`).

Or run them separately in two terminals if you prefer:

```bash
npm run server   # API on http://localhost:4000
npm run dev      # frontend on http://localhost:5173, proxies /api to the API
```

## What's backed by MySQL

- **Product structure** (`items` table) — the whole VP2 tree the app
  renders; fetched once at startup via `GET /api/items`.
- **Revision history** (`revision_history` table) — shown in the
  Properties → History tab and the Compare Revisions dialog.
- **Change requests** (`change_requests` table) — submitting "New Change
  Request" in Structure, and Approve/Reject in My Worklist, are real
  writes (`POST`/`PATCH /api/change-requests`).
- **Activity log** (`activity_log` table) — every change-request
  submission and decision is recorded here and shown live on the
  **Changes** tab, so the whole submit → review → approve/reject workflow
  is visible as an audit trail.

Data survives a page reload or a restart of the frontend/API — it's only
reset when you re-run `npm run db:seed`.

## Troubleshooting

- **"Couldn't reach the PLM API" on load** — the API server isn't
  running, or MySQL isn't reachable. Check `npm run server`'s output and
  that MySQL is up (`mysqladmin ping`).
- **`ER_ACCESS_DENIED_ERROR` from the API** — credentials in `.env` don't
  match what you created in step 2.
- **Empty Structure Explorer** — the tables exist but are empty; run
  `npm run db:seed`.
