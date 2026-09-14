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

## Demonstration script

With the API running (`npm run server`), you can see the whole workflow
run end to end from the command line, without clicking through the UI:

```bash
npm run demo
```

It walks the whole BOM lifecycle against the database: search the items
table, create a new part under an assembly, modify its quantity and cost,
revise it to the next revision, print its revision history, raise and
approve a change request, release the revision, prove the structure rules
are enforced (an assembly with children and the top-level item both refuse
to be deleted), delete the part again, and print the resulting activity
log. Every line is a real read or write against MySQL.

The script cleans up after itself, so it can be run repeatedly. Run
`npm run db:seed` if you want to reset the dataset completely, then open
the app to see the same change request and activity trail live in
**My Worklist** and **Changes**.

## Managing the BOM from the UI

Everything the demo script does is available on the **Structure** screen:

- **Create** — select an assembly, then `+ New item` above the structure
  table. The new line is inserted at its find number under that assembly.
- **Modify** — `Edit` in the Properties panel. Each changed field is named
  in the revision history and the activity log.
- **Revise** — `Revise` in the Properties panel bumps the revision (`/A` →
  `/B`, or a revision you type), moves the item to *In Work* and clears its
  effectivity until it is released again.
- **Delete** — `Delete` in the Properties panel. Assemblies that still have
  child lines and the top-level item are refused; the activity log keeps a
  record of what was removed.
- **Search** — the **Search** tab queries the `items` table directly
  (part number, name, classification and supplier) and narrows by lifecycle
  state and make/buy.

## API

| Method   | Path                          | Purpose                                  |
| -------- | ----------------------------- | ---------------------------------------- |
| `GET`    | `/api/items`                  | Whole product structure                  |
| `GET`    | `/api/items/search`           | `q`, `state`, `mb`, `kind`, `limit`      |
| `POST`   | `/api/items`                  | Create an item under `parent`            |
| `PATCH`  | `/api/items/:id`              | Modify any editable attribute            |
| `POST`   | `/api/items/:id/revise`       | Bump to the next (or a given) revision   |
| `DELETE` | `/api/items/:id`              | Delete a childless item                  |
| `GET`    | `/api/items/:id/history`      | Revision history for one item            |
| `GET`    | `/api/change-requests`        | All change requests                      |
| `POST`   | `/api/change-requests`        | Raise one against an item                |
| `PATCH`  | `/api/change-requests/:id`    | Approve or reject                        |
| `GET`    | `/api/activity`               | Activity log, newest first               |

Writes run in a transaction and record both a revision-history entry and an
activity-log entry, so nothing changes the structure without an audit trail.

## What's backed by MySQL

- **Product structure** (`items` table) — the whole VP2 tree the app
  renders, and every create / modify / revise / delete performed on it.
- **Revision history** (`revision_history` table) — shown in the
  Properties → History tab and the Compare Revisions dialog, with the
  revision each entry was recorded against.
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
