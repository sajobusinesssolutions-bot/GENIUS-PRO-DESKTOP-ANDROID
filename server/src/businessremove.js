/**
 * Taking a business off an account: the owner removes one they no longer run
 * (a test, a closed branch). It is marked inactive, not erased — its data
 * stays on the server, it stops counting towards the plan's limit, and it
 * leaves every list. Separate from sync.js so it deploys on its own.
 *
 *   DELETE /v1/businesses/:id        owner only
 */
import { q } from './db.js';
import { whoami } from './sync.js';

export default async function businessRemoveRoutes(app) {
  app.delete('/v1/businesses/:id', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const { rows } = await q(
      `update businesses set status = 'inactive' where id = $1 and account_id = $2 and status = 'active' returning id, name`,
      [String(req.params.id), me.id],
    );
    if (!rows[0]) return reply.code(404).send({ ok: false, error: 'notFound', message: 'No such business of yours on this account' });
    return { ok: true, business: rows[0] };
  });
}
