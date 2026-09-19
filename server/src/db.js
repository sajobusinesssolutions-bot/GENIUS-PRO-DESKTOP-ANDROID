/**
 * The database pool.
 *
 * One vCPU and one database, so the pool is deliberately small: more
 * connections than cores buys nothing and costs memory. PgBouncer can go in
 * front later if the shape of the load ever justifies it.
 */
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  // a pooled connection dying in the background must not take the process with it
  console.error(JSON.stringify({ level: 'error', at: 'pool', msg: err.message }));
});

export const q = (text, params) => pool.query(text, params);

/** Runs a function inside one transaction, rolling back on any throw. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
