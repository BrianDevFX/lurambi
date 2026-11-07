import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Set DATABASE_URL before running migrations.');

const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(path.join(root, 'db', 'migrations')))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
  for (const filename of files) {
    const alreadyApplied = await client.query('SELECT 1 FROM public.schema_migrations WHERE filename = $1', [filename]);
    if (alreadyApplied.rowCount) { console.info(`Skipped ${filename}`); continue; }
    const sql = await readFile(path.join(root, 'db', 'migrations', filename), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO public.schema_migrations(filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.info(`Applied ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.end();
}
