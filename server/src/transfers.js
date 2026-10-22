/**
 * Stock transfers between businesses, on the account server — so a phone can
 * receive what a computer sent, and the other way round. The rules live in
 * transfers.core.js; this wires them to the database and to sign-in.
 *
 * Deploying: this file, transfers.core.js, and one line in index.js
 * (`await app.register(transferRoutes)`). The table makes itself.
 */
import { q } from './db.js';
import { whoami } from './sync.js';
import { ensureTransfersTable, registerTransfers } from './transfers.core.js';

export default async function transferRoutes(app) {
  await ensureTransfersTable(q);
  registerTransfers(app, { q, who: whoami });
}
