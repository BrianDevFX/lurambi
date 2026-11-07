import pg from 'pg';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
});

function retryableConnectionError(error) {
  return !error?.code || ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','57P01','57P03'].includes(error.code);
}

export async function withActor(userId, callback) {
  if (!userId) throw new Error('An acting user is required for this database operation.');
  return withTransaction(async (client) => {
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    return callback(client);
  });
}

export async function withTransaction(callback) {
  let client;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { client = await pool.connect(); break; }
    catch (error) {
      if (attempt || !retryableConnectionError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  if (!client) throw new Error('Could not connect to PostgreSQL.');
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function databaseHealth() {
  const result = await pool.query('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}
