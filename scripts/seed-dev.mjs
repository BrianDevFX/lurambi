import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to a local PostgreSQL database.');
const host = new URL(url).hostname.toLowerCase();
if (!['localhost','127.0.0.1','::1'].includes(host)) throw new Error('Development seed is restricted to local PostgreSQL.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = await readFile(path.join(root,'db','seed.dev.sql'),'utf8');
const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
await client.connect();
try { await client.query('BEGIN'); await client.query(sql); await client.query('COMMIT'); console.info('Synthetic development places and contacts seeded.'); }
catch (error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
