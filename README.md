# Lurambi Field Platform

Vite + React SPA with a Vercel Node function and Neon Postgres. The browser calls same-origin API endpoints; database credentials stay on the server. This Phase A foundation includes the database schema, migration and local admin tools, plus a health endpoint. Login and field workflows are built in later phases.

## Requirements

- Node.js 22 or newer
- A Neon project and its pooled connection string for a deployed database
- PostgreSQL 16 or newer for local migration checks

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set `DATABASE_URL` to a local or development Neon pooled PostgreSQL connection string (`sslmode=require` for Neon).
3. Set `JWT_SECRET` to a long random value. Do not commit `.env.local`.
4. Install and run:

```sh
npm ci
npm run db:migrate
npm run db:create-admin
npm run dev
```

`db:create-admin` reads `ADMIN_PHONE`, `ADMIN_PASSWORD`, and `ADMIN_NAME` from the shell and never prints the password. The optional `npm run db:seed:dev` is restricted to localhost and inserts clearly synthetic places and network contacts.

The local API middleware serves `GET /api/health`; it returns `{ "ok": true, "db": true }` after a database query succeeds.

## Database

Versioned migrations are in `db/migrations/`. Run `npm run db:migrate` to apply each migration once, recorded in `schema_migrations`. Migrations include the six reference wards and their known aliases. Synthetic locations and contacts are separate in `db/seed.dev.sql`.

## Deploy to Vercel

1. Create a Neon project and copy its pooled connection string.
2. Create a fresh Vercel project from this repository with the **Vite** framework preset.
3. Set `DATABASE_URL` and a long random `JWT_SECRET` in Vercel project settings. These are the only Vercel environment variables in Phase A.
4. Run `npm run db:migrate` against the Neon database from a trusted local environment.
5. Create the first administrator with `npm run db:create-admin` using shell variables, then deploy.
6. Open `/api/health` on the deployment and confirm the response reports `ok` and `db` as `true`.

## Checks

```sh
npm run lint
npm test
npm run build
```

Use synthetic data for development and testing. Do not load real supporter data until the later authentication, role, consent, capture and export workflows are implemented and reviewed.
