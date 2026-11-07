# Lurambi Field Platform

Vite + React single page app, one Vercel Node API function, and Neon Postgres. The browser calls same-origin API routes; only the server reads `DATABASE_URL`. The app includes phone/password accounts, approval by role, supporter capture, consent, imports/exports, public referral registration, a data request form, dashboards, and an offline queue.

## Requirements

- Node.js 22 or newer
- PostgreSQL 16 or newer for local development, or a Neon project for a deployment
- A pooled Neon connection string for deployed use

## Local setup

1. Copy `.env.example` to `.env.local`. Put only `DATABASE_URL` and `JWT_SECRET` in that file. Do not commit it. `JWT_SECRET` must be a long random value.
2. Set those values in the shell where commands will run. `npm` scripts do not automatically load `.env.local`.
3. Install dependencies, apply migrations, then create the first administrator with shell-only values:

```sh
npm ci
npm run db:migrate
npm run db:create-admin
npm run dev
```

`db:create-admin` requires `ADMIN_PHONE`, `ADMIN_PASSWORD`, and `ADMIN_NAME` in the shell. It hashes the password and never prints it. Do not put these admin values in `.env.example` or commit them.

For local-only synthetic places and contacts, run `npm run db:seed:dev`. The script refuses non-local database URLs. Never run it against a shared or live database. The six reference wards and aliases are inserted by migrations; official centres and stations should be loaded through the admin Places import.

The local Vite middleware and Vercel function use the same router. `GET /api/health` returns `{ "ok": true, "db": true }` when PostgreSQL responds.

## Database and deployment

Migrations in `db/migrations/` are applied once and recorded in `schema_migrations`.

1. Create a Neon project and copy its pooled connection string. Use a separate development project before production.
2. Set `DATABASE_URL` and a long random `JWT_SECRET` in the shell and run `npm run db:migrate` against that development database.
3. Create the first administrator with `npm run db:create-admin`, setting the three `ADMIN_*` variables in the shell only.
4. Import the repository into a fresh Vercel project with the Vite framework preset.
5. In Vercel settings, set `DATABASE_URL` and `JWT_SECRET`, then deploy.
6. Check `/api/health`, sign in as the admin, import official places, and review the consent wording in Settings before allowing captures.

Only `DATABASE_URL` and `JWT_SECRET` are Vercel environment variables. The browser has no database connection string or database key.

## Field workflows

- Mobilizers register with a phone and password. Admins approve them; coordinators can approve within their ward.
- Mobilizers search their own list before capture. Entries require explicit consent. National IDs are sent to the server over HTTPS and masked in responses.
- The public referral page is `/join/<referral-code>`. It requires a pledge and consent and displays a generic success response. The Privacy Notice is `/privacy`; data requests are submitted at `/dsr`.
- Public join and DSR forms include a honeypot. CAPTCHA, request throttling, login lockout, and other deferred controls are listed in `HARDENING_BACKLOG.md`.
- Offline drafts use IndexedDB and sync with the same `client_request_id` when online. To avoid persisting National IDs in browser storage, entries containing an ID must be saved online; offline queueing is available when the ID is blank. The queue retains per-item errors and server-confirmed duplicate results.
- Admin imports accept `.xlsx` and `.csv`, up to 5 MB and 20,000 rows. Review column mapping and dry-run results before committing. Use synthetic files in development.

## Checks

```sh
npm run lint
npm test
npm run build
```

Tests that exercise the API require a disposable local PostgreSQL database. They reject non-local database URLs and use generated synthetic fixtures. Do not point tests at production.

## Smoke test checklist

- [ ] Sign in as admin, coordinator, and approved mobilizer; confirm pending users cannot capture.
- [ ] Register a mobilizer, approve it, capture an entry with consent, then confirm it appears in My List.
- [ ] Submit a duplicate and confirm it is blocked; confirm a shared phone alone is not a duplicate.
- [ ] Confirm the mobilizer cannot edit or delete entries; edit as admin with a reason and verify the audit log.
- [ ] Import a synthetic workbook: inspect mapping and preview, run a dry run, commit, then re-run and confirm no extra row is created.
- [ ] Export entries as CSV, Excel, and PDF; open the files and confirm formula-like values are neutralized.
- [ ] Open `/join/<code>` at phone width, submit synthetic details with consent, and confirm attribution to the mobilizer.
- [ ] Open `/privacy` and `/dsr`; submit a synthetic data request and action it from the admin queue.
- [ ] Filter the dashboard and download a panel export; verify totals against the synthetic database.
- [ ] Install the app, capture an entry without an ID while offline, reconnect, and verify the queue reports saved/duplicate/error results without dropping unresolved items.
- [ ] Confirm capture with an ID is retried online and that mobilizer/coordinator responses show only masked IDs.
