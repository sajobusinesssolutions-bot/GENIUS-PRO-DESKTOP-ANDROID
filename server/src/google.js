/**
 * Google sign-in, done entirely on this side.
 *
 * The phone opens `/start` here and never speaks to Google directly. We hold
 * the client secret, we do the exchange, and we hand the app one of *our*
 * sessions — so nothing Google-issued is ever treated as a credential for this
 * service, and no secret ships inside an APK that anyone can unzip.
 *
 * The browser is sent back to the app with a short-lived, single-use ticket
 * rather than a session: a redirect URL is written to browser history and to
 * the system log, and a refresh token sitting there would outlive the sign-in
 * by months.
 */
import { randomBytes, createHash } from 'node:crypto';
import { decodeJwt } from 'jose';
import { q } from './db.js';
import { issueSession, normalise } from './auth.js';
import { allowedRedirect } from './redirect.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** state → where to send the browser back to. Short-lived and in memory. */
const pending = new Map();


function sweep() {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
}

export default async function googleRoutes(app) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const ticketTtl = Number(process.env.GOOGLE_TICKET_TTL || 120);

  /* --- the app sends the browser here --------------------------------- */
  app.get('/v1/auth/google/start', async (req, reply) => {
    sweep();
    const back = String(req.query?.redirect || process.env.APP_RETURN_URL);

    if (!allowedRedirect(back)) {
      return reply.code(400).send({ error: 'malformed', message: 'Bad redirect.' });
    }

    const state = randomBytes(16).toString('base64url');
    pending.set(state, { back, expires: Date.now() + 10 * 60_000 });

    const url = new URL(AUTH_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    return reply.redirect(url.toString(), 302);
  });

  /* --- Google sends the browser back here ------------------------------ */
  app.get('/v1/auth/google/callback', async (req, reply) => {
    sweep();
    const { code, state, error } = req.query || {};
    const held = state ? pending.get(state) : null;
    if (held) pending.delete(state);

    const back = held?.back || process.env.APP_RETURN_URL;
    // An Expo Go return address already carries a path, and may carry a query,
    // so the separator is chosen rather than assumed.
    const bounce = (params) => reply.redirect(
      back + (back.includes('?') ? '&' : '?') + new URLSearchParams(params).toString(),
      302,
    );

    if (error) return bounce({ error: String(error) });
    if (!held) return bounce({ error: 'expired' });
    if (!code) return bounce({ error: 'no_code' });

    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!res.ok) {
        req.log.error({ status: res.status }, 'google token exchange failed');
        return bounce({ error: 'exchange_failed' });
      }
      const tokens = await res.json();

      // The id token came straight from Google's token endpoint over TLS in
      // response to our own request, so it is trusted without a second fetch of
      // the JWKS. Anything arriving by another route would need verifying.
      const claims = decodeJwt(tokens.id_token);
      const email = normalise(claims.email);
      if (!email || claims.email_verified === false) return bounce({ error: 'unverified_email' });

      const { rows } = await q('select id, email, name from accounts where email = $1', [email]);
      let account = rows[0];

      if (!account) {
        const created = await q(
          `insert into accounts (email, name, google_sub, email_verified)
           values ($1, $2, $3, true) returning id, email, name`,
          [email, claims.name || email.split('@')[0], claims.sub],
        );
        account = created.rows[0];
        await q(
          `insert into licences (account_id, plan, term, seats, status, expires_at)
           values ($1, 'trial', 'monthly', $2, 'trial', now() + ($3 || ' days')::interval)`,
          [account.id, Number(process.env.TRIAL_SEATS || 2), String(process.env.TRIAL_DAYS || 30)],
        );
      } else {
        // Links the Google identity to an account that already signs in by
        // password, so the same person does not end up with two sets of books.
        await q('update accounts set google_sub = coalesce(google_sub, $2) where id = $1',
          [account.id, claims.sub]);
      }

      const ticket = randomBytes(24).toString('base64url');
      await q(
        `insert into google_tickets (ticket, account_id, expires_at)
         values ($1, $2, now() + ($3 || ' seconds')::interval)`,
        [createHash('sha256').update(ticket).digest('hex'), account.id, String(ticketTtl)],
      );
      return bounce({ ticket });
    } catch (e) {
      req.log.error({ err: e.message }, 'google callback failed');
      return bounce({ error: 'server' });
    }
  });

  /* --- the app trades the ticket for a session ------------------------- */
  app.post('/v1/auth/google/redeem', async (req, reply) => {
    const raw = String(req.body?.ticket || '');
    if (!raw) return reply.code(400).send({ error: 'malformed', message: 'No ticket.' });

    const hash = createHash('sha256').update(raw).digest('hex');
    const { rows } = await q(
      `update google_tickets set used_at = now()
        where ticket = $1 and used_at is null and expires_at > now()
        returning account_id`,
      [hash],
    );
    if (!rows[0]) {
      return reply.code(401).send({
        error: 'badCredentials',
        message: 'That sign-in has expired. Try again.',
      });
    }
    const acct = await q('select id, email, name from accounts where id = $1', [rows[0].account_id]);
    return issueSession(acct.rows[0], 'google sign-in');
  });
}
