# BOM-managment-system

A PLM-style Structure Explorer (product tree, BOM table, properties,
change requests, and an activity feed) built with React + TypeScript on
the frontend and a MySQL-backed Express API on the backend.

BOM management is fully wired to the database:

- **Create** parts and sub-assemblies under any assembly
- **Modify** any item attribute, with every changed field recorded
- **Revise** an item to its next revision, which returns it to *In Work*
- **Delete** items, with the structure rules enforced by the database
- **Search** the `items` table by part number, name, classification or
  supplier, narrowed by lifecycle state and make/buy

Each write runs in a transaction and appends to both the revision history
and the activity log, so the Changes screen shows a complete audit trail.

See [SETUP.md](./SETUP.md) for how to install MySQL, migrate/seed the
database, run the app, and run `npm run demo` — a scripted walk through
the whole workflow from the command line.
