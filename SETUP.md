# Running the demo

The Structure Explorer's product data, change requests, and activity log
are all persisted in a real database (SQLite) — nothing is held only in
browser memory. There's no database server to install: it's a single
file on disk (`server/data/plm_demo.sqlite`).

## 1. Install dependencies

```bash
npm install
```

## 2. Create and seed the database

```bash
npm run db:migrate   # creates items / revision_history / change_requests / activity_log
npm run db:seed      # loads the VP2 product structure + revision history
```

`db:seed` deletes and reloads the demo tables, so it's safe to re-run
whenever you want to reset the workflow back to a clean state (e.g. after
submitting and approving change requests during a demo).

## 3. Run it

Two processes: the Express API (reads/writes the SQLite file) and the
Vite dev server (proxies `/api/*` to the API).

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

No `.env` file is required — the database file and API port both have
working defaults. Copy `.env.example` to `.env` only if you want to
override `DB_FILE` or `API_PORT`.

## What's backed by the database

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

Data survives a page reload, and a restart of the frontend and/or API —
it's a real file on disk. It's only reset when you re-run
`npm run db:seed`.

## Inspecting the database directly

```bash
sqlite3 server/data/plm_demo.sqlite
sqlite> select * from change_requests;
sqlite> select * from activity_log order by happened_at desc;
```

## Troubleshooting

- **"Couldn't reach the PLM API" on load** — the API server isn't
  running. Check `npm run server`'s output.
- **Empty Structure Explorer** — the database exists but is empty; run
  `npm run db:seed`.
- **Want a fresh database file entirely** — delete
  `server/data/plm_demo.sqlite*` and re-run `npm run db:migrate && npm run db:seed`.
