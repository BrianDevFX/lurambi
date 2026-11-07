# Build log

## Phase A — Neon foundation

- Created a clean sibling repository with one fresh `main` history; only the final sanitized snapshot is committed.
- Replaced the copied Supabase database/client/API setup with PostgreSQL migrations, a `pg` pool, actor transaction helper, JWT/cookie helpers, and a Vercel catch-all API function with a health endpoint.
- Added migration, localhost-only synthetic seed, and first-admin scripts. Rewrote environment example and setup documentation for Neon/Vercel.
- Removed the copied hosted-database migrations, old-only handlers and UI, PWA registration, and RLS tests. The previous screens were directly coupled to the old database client and are being reconnected to the API in subsequent phases.
- Synthetic test data only. No external database or hosted service was contacted.

### Validation

- `npm run lint`: PASS.
- `npm test`: PASS — 1 test file, 20 cases.
- `npm run build`: PASS — 220.00 kB JS (68.83 kB gzip), 0.34 kB CSS.
- Isolated PostgreSQL 18 local cluster: both migrations applied; second run skipped both; synthetic dev seed loaded (6 wards, 12 centres).
- Local `GET /api/health`: PASS — `{ "ok": true, "db": true }`.
- No hosted database, Vercel account or external service was contacted.
- Known gap: this phase exposes only the API health shell. Authentication and field workflows follow in Phase B.

### Phase A routing follow-up

- Vercel served the SPA shell for `/api/health` after the first routing change. The native Vite Functions convention uses concrete files under `api/`, so the catch-all is now a concrete `api/handler.js` function with `/api/:path*` forwarded through a query parameter to the internal router. The SPA rewrite remains the final fallback.
- The routing change is validated locally; a Vercel preview is still required to confirm its platform routing behavior.

### HUMAN STEPS

- Create a Neon project and copy its pooled connection string.
- Set `DATABASE_URL` and a long random `JWT_SECRET` in local `.env.local` and in the new Vercel project settings.
- Run `npm run db:migrate` against the new development database and `npm run db:create-admin` with shell-only admin values.
- Import the new GitHub repository into a fresh Vercel project using the Vite preset, deploy, and open `/api/health`.

## Phase B — Auth and mobilizer flow

- Added phone/password signup and login with bcrypt hashes, signed 12-hour HttpOnly session cookies, logout, and a `/api/me` profile check. Each request reloads current role/status from PostgreSQL so approval and suspension take effect without trusting stale JWT claims.
- Added role-scoped mobilizer approval/suspension, admin password reset, and database-backed ward/centre/station endpoints. Coordinators are restricted to their ward by the API and SQL approval functions.
- Added entry capture, consent-policy lookup, own-entry list/search, server-side normalization and ID masking, idempotency, duplicate blocking/logging, and read-only admin/coordinator entry lists. The browser uses the same-origin API client and contains no database credentials.
- Added mobile mobilizer tabs for Search/Add, My List, My Link and Profile; a basic admin/coordinator workspace; registration, pending approval and suspended screens; and a minimal Privacy Notice.
- Added migration `0003_phase_b_auth_entries.sql` for role-checked approval/capture/search functions and entry constraints. The local API smoke test uses only generated synthetic records and refuses non-local database URLs.

### Validation

- `npm run lint`: PASS (`tsc --noEmit`).
- `npm test` with `DATABASE_URL` set only to the disposable PostgreSQL instance on `127.0.0.1:55432`: PASS — 2 test files, 21 tests.
- `npm run build`: PASS — 48 modules; JS 264.15 kB (82.80 kB gzip), CSS 3.61 kB (1.29 kB gzip).
- `npm run db:migrate` run twice against the disposable local PostgreSQL instance: PASS — all three migrations already applied; second run made no changes.
- No Neon or Vercel account/database was accessed. No production data was used.

### Known gaps

- Phase C still needs admin operations, imports/exports, place management, and operational verification tools. Phase D still needs the public join/DSR flows and dashboard/offline work.
- Fresh Neon contains the six wards and aliases but no real polling centres/stations. Do not use synthetic development place data for field operations; populate official place data when the Phase C Places import is available.
- Vercel preview behavior for the Phase B APIs was not checked. This branch has not been pushed or deployed.
- Consent text in the current migration is a starter version; campaign staff must review and approve its wording before collecting live supporter data.

### HUMAN STEPS

- Do not use the live system with supporter data yet: the Phase C places/import and admin operations are still outstanding, and the consent wording needs campaign approval.
- To exercise Phase B locally, start the disposable/local PostgreSQL service, set a local `DATABASE_URL` and a strong local `JWT_SECRET`, run `npm run db:migrate`, then `npm run db:seed:dev` for synthetic places only. Set `DATABASE_URL` and `JWT_SECRET` in the shell before `npm run dev`.
- To test with a fresh Neon development project after this branch is reviewed, apply the migrations there, create the first admin with shell-only `ADMIN_PHONE`, `ADMIN_PASSWORD`, and `ADMIN_NAME`, and provision official wards/centres/stations before attempting capture. Do not seed synthetic place records into a live project.
- Review and replace the starter consent text/version before any real capture.

## Phase C — Admin operations, import and exports

- Added migration `0004_phase_c_admin.sql` for admin-only entry edits with a mandatory reason and audit record, flag resolution/dismissal, evidence-noted verification status updates, and scoped export logging. Added `0005_mobilizer_export_log.sql` so approved mobilizers can log their own-entry exports.
- Added admin API and workspace areas for flags, verification, entry edit, import/export, place alias mapping, network contacts, audit log, and settings. Coordinator entry lists remain read-only and role-scoped.
- Added a browser import wizard for `.xlsx` and `.csv` with type selection, column mapping, first-sheet preview (20 rows), file-size/row-count checks, batches capped at 500, dry-run counts, import records, and a downloadable dry-run report. Server batch handlers support entries, network contacts, and ward/centre/station place rows. Entry imports normalize phone and ID, mark legacy consent as unconfirmed, map exact ward/place aliases, flag invalid/missing ID and invalid phone, and use row hash plus unique ID conflicts for safe repeat submissions.
- Added role-scoped CSV/XLSX/PDF entry exports, a verification export, spreadsheet formula neutralization, export logging, admin settings editing with a reason, and contact reach-status/notes/CHP exclusion controls.
- The attempted legacy pseudo-user creation was omitted after automatic review rejected an approved `admin`-role pseudo-account as an unintended privilege grant. Legacy imports are stored with `source='legacy'`, a batch ID, `consent_status='legacy_unconfirmed'`, and `mobilizer_id=NULL`; whether to add a non-login pseudo-user identity needs a safer schema decision.

### Validation

- `npm run lint`: PASS (`tsc --noEmit`).
- `npm test`: PASS — 3 test files, 29 tests, using the disposable PostgreSQL instance on localhost. Covers admin reason/audit, verification update, non-writing dry-run, import idempotency, export logging and formula neutralization, plus Phase B API checks.
- `npm run build`: PASS — JS 279.07 kB (86.67 kB gzip), dynamically loaded XLSX chunk 491.99 kB (160.33 kB gzip), CSS 3.99 kB (1.39 kB gzip).
- Local migrations run twice: PASS — `0004_phase_c_admin.sql` and `0005_mobilizer_export_log.sql` applied once and skipped on the second run.
- No hosted database, Vercel account or real supporter data was used.

### Known gaps

- Import currently assumes the first worksheet row is the header. Dry-run runs the validation/mapping path without writes; it does not execute the full insert transaction and roll it back. Error reasons are downloaded, but the report does not yet contain a complete per-row imported/merged/flagged report.
- Cross-tab merge by normalized ID prevents a second row insert, but does not update the retained record to the earliest `captured_on`. More advanced trigram matching, register-based flags, all legacy import edge cases, and a persistent needs-mapping queue are incomplete.
- The legacy import attribution is `mobilizer_id=NULL`, not a dedicated pseudo-user. A safer representation is a human/schema decision after the auto-review rejection described above.
- Admin UI flag actions resolve or dismiss; merge is not implemented. The verification page is a flat list with per-entry updates; the API supports bulk updates, but grouped and bulk UI is still needed.
- Network contact import and place import are available through the same mapped wizard, but there is no dedicated contact export, full place CRUD/replacement workflow, or persistent needs-mapping review screen.
- Entry exports are implemented; flag, summary, performance, and network-contact exports, downloadable import templates, and PDF page numbers/filter headers remain incomplete. Admin edit UI currently exposes name only although the API supports several fields.
- Vercel preview behavior was not checked. Phase C branch has not been pushed or deployed.

### HUMAN STEPS

- Do not point this branch at production or import real data yet. Review the known gaps above and wait for the Phase D release before field use.
- For local Phase C testing, use a local PostgreSQL database only, set local `DATABASE_URL` and `JWT_SECRET`, and run `npm run db:migrate`; use `npm run db:seed:dev` only for synthetic places in the local database.
- Before any deployed preview test, push/review this branch, configure a separate Neon development database, apply migrations `0001` through `0005`, and use only a synthetic workbook.
- Decide how legacy rows should be attributed without granting a login role to the pseudo-user. Campaign staff must also approve the consent text before captures.

## Phase D — Public join, dashboard, offline and ship preparation

- Added migration `0006_public_join_dashboard.sql` with a referral-attributed `app.public_join` database function. It validates the referrer, place hierarchy and consent, normalizes phone/ID, stores the ID with its masked form, computes duplicate/phone/register flags, logs blocked duplicate attempts, and records `source='self_registered'`. The public API returns the same generic success message for accepted and duplicate submissions.
- Added the English/Kiswahili public `/join/<code>` page, pledge and consent checkboxes, Privacy Notice link, honeypot, `/dsr` request form, public generic-response endpoints, and admin DSR queue with audit-logged actions.
- Added role-scoped real-data dashboard queries and panels for ward/station totals, support, verification, completeness, priority stations, mobilizer quality, issues, capture timeline and network contacts. Filters cover ward/place, mobilizer (admin), dates, support, status and source. Each panel has an Excel export logged through `app.log_export`.
- Added an install manifest, service worker shell cache, and IndexedDB offline queue with reconnect sync and per-item saved/duplicate/error states. The queue explicitly rejects any draft with a National ID and never stores an `national_id` property; ID-bearing submissions need an online connection.
- Added lazy loading for role and public-page components. XLSX stays dynamically imported. Updated README smoke checks and the hardening backlog.

### Validation

- `npm run lint`: PASS (`tsc --noEmit`).
- `npm test`: PASS — 4 files, 32 tests, including local API tests for public join attribution/generic duplicate responses, DSR submission/action, dashboard role scoping, and offline ID stripping. The API tests used the disposable PostgreSQL instance on localhost and generated synthetic data only.
- `npm run build`: PASS — main JS 225.88 kB (70.87 kB gzip); lazy XLSX chunk 491.99 kB (160.33 kB gzip); admin workspace 24.95 kB (6.24 kB gzip); mobilizer workspace 35.79 kB (12.51 kB gzip).
- Migration `0006_public_join_dashboard.sql` applied locally; the subsequent migration run skipped it and all earlier migrations.
- Static scan found no VITE/legacy secret-variable usage and no selected secret patterns in `dist/`. Vercel headers in config include `X-Content-Type-Options` and `Referrer-Policy`; no preview was contacted.
- No Neon, Vercel account, production database, or real supporter data was accessed.

### Known gaps

- Deployed preview and mobile-device smoke tests were not run. PWA install and offline sync are covered by code/build and queue privacy tests only; a phone-width browser test with network toggling remains necessary.
- Offline drafts with a National ID cannot be queued because the browser must never persist an ID. Mobilizers must retry those entries online.
- Public join and DSR have Zod validation and honeypots but no CAPTCHA or rate limiting; those remain deliberately deferred in `HARDENING_BACKLOG.md`.
- DSR actions update request status/notes but do not automatically mutate supporter records. Dashboard coverage does not yet calculate register-size coverage from loaded register rows. Dashboard and import/export panels still have the Phase C limitations above.
- The privacy notice and consent wording need campaign review. This branch is not ready for real supporter data until the security backlog, data workflows, and deployed smoke test are reviewed.
- The configured `origin` URL is `https://github.com/BrianDevFX/lurambi.git`. It contains the clean Phase A history, but its repository name differs from the requested `lurambi-field-platform`; verify it is the intended private target before pushing this phase.
- Push attempt for `build/phase-d` was rejected by automatic approval review because the configured GitHub destination did not match the requested new repository name and its privacy was unverified. No remote was changed and no push was completed.

### HUMAN STEPS

- Review/approve the Privacy Notice and consent text before any real capture.
- Before preview deployment, confirm the GitHub destination is the intended private repository. Configure only a separate development Neon database and Vercel preview; apply migrations `0001`–`0006` and create a synthetic test admin.
- Test `/api/health`, all three roles, public join and DSR, admin audit, exports, and the PWA on a 360px phone viewport. Toggle network offline/online and verify a no-ID draft syncs and retains errors; verify ID-bearing capture waits until online.
- Review the hardening backlog before any live data. Do not run the synthetic seed on shared or production databases.

## Mobilizer search bug fix

- Replaced the search route's dependency on `app.search_my_entries` with a parameterized query against `public.entries`, scoped to the authenticated mobilizer ID. It supports name/phone search and exact 7–8 digit ID search, returns place labels required by the list UI, remains capped at 10 rows, and selects only masked IDs.
- Added API regression checks for search results, place labels, owner scoping, exact National ID search, and absence of full National IDs from responses.
- `npm test`: PASS — 32 tests against disposable localhost PostgreSQL. `npm run lint` and `npm run build`: PASS.
- Likely production cause: the deployed database may not have the Phase B search function migration, causing the route to return a generic 500. The replacement removes that specific function dependency; production was not queried or changed.

### Phase D follow-up — 2026-11-07

- After the repository owner confirmed `BrianDevFX/lurambi.git` is the intended public repository, pushed `build/phase-d` at commit `5c23b0ea7ff2e2438d8a6f8d39202c6a002f8de4`. Remote and local branch hashes match; no merge was performed.
- Replayed migrations `0001`–`0006` from an empty disposable localhost database. All six applied; a second run skipped all six.
- The attempt to run migrations from `.env.local` was blocked by automatic review because the connection target was not identified as development/test. No remote database migration was run. To continue safely, configure an untracked `.env.test` with a dedicated development/test `DATABASE_URL` and rerun with `node --env-file=.env.test scripts/migrate.mjs`.
- After `.env.test` was confirmed ready, ran `node --env-file=.env.test scripts/migrate.mjs`: `0001` and `0002` were already applied; `0003` through `0006` were applied successfully. The follow-up run skipped all six migrations. The PostgreSQL driver printed a non-fatal SSL-mode compatibility warning; no migration error occurred.


## Admin places workflow follow-up — 2026-11-08

- Fixed the mobilizer station dropdown: the places API returns station_name, and the form now renders that field instead of the missing name. This also makes the existing dev-seeded stations visible.
- Added admin-only centre/station create and rename routes and forms to the Places tab. Each change requires a reason and writes old/new values to audit_log; existing place IDs remain stable when renamed.
- Kept the six support levels as fixed capture choices; the admin Places tab now says they are selected on Search/Add and lists them.
- The local seed remains clearly synthetic and dev-only. The Places tab points admins to the official CSV import for production source data; no real place list was invented.
- Added localhost API smoke coverage for returned station labels, role-protected place create/rename, required reasons, and audit records.
- Validation: npm run lint PASS; npm test PASS (4 files, 32 tests with local PostgreSQL); npm run build PASS. The database-backed smoke tests used only the disposable localhost PostgreSQL cluster and synthetic fixtures. Production was not contacted.
- Not deployed. Changes are on codex/admin-operations for review.
