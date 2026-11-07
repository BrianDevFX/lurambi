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
