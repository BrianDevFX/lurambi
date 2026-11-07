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
