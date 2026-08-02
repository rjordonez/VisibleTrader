# VisibleTrader

Real-time Polymarket "smart money" tracker — React + TypeScript + Vite
frontend, a Python backend that watches Polymarket's live trade feed, and
Supabase (Postgres) in between.

## Setup

```bash
npm install
```

## Environments

Two Supabase projects, kept separate so local testing never touches real
production data:

| | Purpose | Written to by | Read by |
| --- | --- | --- | --- |
| **dev** | Local development/testing — safe to break | `live-signal-service.py` run manually on your machine | `npm run dev` |
| **prod** | The real thing | `live-signal-service.py` running as a `systemd` service on the GCP VM, 24/7 | The Vercel-deployed frontend |

**Never run `live-signal-service.py` locally against prod's `DATABASE_URL`**
— it writes trades/opportunities into whatever database it's pointed at,
and running two copies against the same database (one local, one on the
VM) causes duplicate writes. This actually happened once — see git history
around the GCP VM setup for the incident.

Config files:
- `.env` — reference copy of prod's values (not used by anything directly
  once `.env.local` exists; Vite prefers `.env.local` when both are
  present, same as `sync_wallet_directory.py`/`apply_migration.py`).
- `.env.local` — your local dev values (`VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `DATABASE_URL` — all pointed at the **dev**
  Supabase project). This is what `npm run dev` and any locally-run Python
  script actually pick up. Gitignored, same as `.env`.
- The GCP VM has its own independent `.env` (never synced via git) pointed
  at **prod** — untouched by anything above.
- `DEV_DATABASE_URL` / `PROD_DATABASE_URL` — both kept in your local
  `.env`/`.env.local`, used only by `scripts/apply_migration.py` so it can
  target either database explicitly by name.

## Deploying

**Backend (GCP VM)**:
```bash
git push origin main
./scripts/deploy.sh
```
Pulls latest onto the VM and restarts the `systemd` service. The frontend
deploys itself automatically (Vercel, on push to `main`) — no separate step.

**Database migrations** — write the migration, then:
```bash
python3 scripts/apply_migration.py supabase/migrations/some_file.sql --target dev
# test against dev, confirm it's right
python3 scripts/apply_migration.py supabase/migrations/some_file.sql --target prod
```
The Supabase GitHub integration does not auto-apply migrations in this
project — this direct-apply path is the real one.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server (reads `.env.local` → dev Supabase) |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run ESLint |
| `python3 scripts/live-signal-service.py` | The live trade-watching backend — only run this locally against **dev** |
| `python3 scripts/apply_migration.py <file> --target dev\|prod` | Apply a migration to one database |
| `./scripts/deploy.sh` | Deploy latest `main` to the prod VM |
| `python3 scripts/sync_wallet_directory.py --database-url <url>` | One-time: populate `wallet_directory` from `polymarket_users.json` (needed once per new database) |

## Project structure

```
src/
  app/            # The logged-in product (Signals, Profits, Leaderboard, etc.)
  landing/        # Marketing/landing page
scripts/
  live-signal-service.py   # Backend: watches Polymarket's live trades, writes to Supabase
  apply_migration.py       # Applies a migration file to dev or prod
  deploy.sh                # Deploys main to the prod VM
  sync_wallet_directory.py # One-time wallet_directory seed
supabase/
  migrations/     # Schema, applied manually — see "Deploying" above
```
