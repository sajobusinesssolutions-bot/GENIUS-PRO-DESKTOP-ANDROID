/**
 * The database pool.
 *
 * With PgBouncer in front (PGBOUNCER_URL, set by deploy/speedup-install.sh)
 * the API may hold many client connections cheaply: PgBouncer shares a dozen
 * real PostgreSQL connections between them a transaction at a time, so a
 * slow request no longer makes every other one wait for a free connection.
 * Without it, the pool stays small: on one vCPU more real connections than
 * cores buys nothing and costs memory. Every lock the API takes is per
 * transaction (pg_advisory_xact_lock), which is what transaction pooling needs.
 */
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.PGBOUNCER_URL || process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || (process.env.PGBOUNCER_URL ? 40 : 8),
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
