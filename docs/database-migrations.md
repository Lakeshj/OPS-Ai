# Database migrations — local → live parity

**Rule:** Any database structure change must ship as a file under [`backend/migrations/`](../backend/migrations/) and be applied on every environment with `npm run db:migrate`.

Do **not** alter live MySQL only in a GUI. That drifts local and production.

## What goes where

| Change type | Where it lives | How live gets it |
|-------------|----------------|------------------|
| New table / column / index / ENUM | `backend/migrations/NNN_name.sql` | `npm run db:migrate` on live |
| Engine / Wait / Schedule **rules** (JS/TS) | `backend/services/*`, frontend contracts | Git push + app restart |
| Seed / sample data | Separate seed scripts | Run only when intentional |

## How migrations run

[`backend/scripts/migrate.js`](../backend/scripts/migrate.js):

1. Ensures `schema_migrations` exists
2. Reads `backend/migrations/*.sql` in sorted name order (`001_…` → `015_…`)
3. Skips filenames already recorded in `schema_migrations`
4. Applies new SQL, then records the filename

```text
Schema change needed
        ↓
Add backend/migrations/NNN_name.sql
        ↓
Local:  cd backend && npm run db:migrate
        ↓
Git push (include the .sql file)
        ↓
Live:   cd backend && npm run db:migrate
        ↓
Live DB matches local schema
```

## Author checklist (every schema change)

1. Never change schema only in local Workbench without a migration file
2. Always add the **next** numbered file (e.g. `016_….sql`) — do **not** edit migrations already applied on any machine
3. Run `cd backend && npm run db:migrate` locally
4. Commit the migration with the feature
5. After deploy to staging/live: run `db:migrate` (or use `deploy.sh` / `npm start`, which run migrate)

## Live deploy checklist

1. Push code that includes new `backend/migrations/*.sql` file(s)
2. On the live host (live `.env` DB credentials):

```bash
cd source/backend   # or your live backend path
npm run db:migrate
```

3. Restart the backend (`pm2 restart opsai-backend` or via `./deploy.sh`)
4. Confirm migrate log: `Applied NNN_…` or `Skipping … (already applied)`

Live migrate must use the **production** database (same `DB_*` as the live API).

## Part 8A (Wait) — required on live once

After deploying Wait, live must apply `015_workflow_waits.sql` (via migrate) for:

- `workflow_runs.status` including `waiting`
- `definition_snapshot_json`, `waiting_node_id`, `resume_at`
- `workflow_run_steps.status` including `waiting`
- table `workflow_waits`

Without migrate, Wait suspend/resume fails on live (missing columns/table).

## Automatic migrate

- `npm start` in backend runs migrate first (`prestart`)
- VPS [`deploy.sh`](../deploy.sh) runs `npm run db:migrate` before PM2 restart

`npm run dev` (nodemon) does **not** auto-migrate on every reload — run `db:migrate` manually after adding a new SQL file.
