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
import { whoami } from './sync.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FOLDER = 'Genius Pro Backups';

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
    // Google's phone layout. Without it the account chooser can come up in its
    // desktop layout inside the in-app browser, small and hard to tap.
    url.searchParams.set('display', 'touch');
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

      // Linking Google Drive for backups, not signing in: keep the refresh
      // token against the account that asked, and go back to the app.
      if (held.kind === 'drive') {
        if (!tokens.refresh_token) return bounce({ drive: 'error', error: 'no_refresh_token' });
        let googleEmail = null;
        try { googleEmail = normalise(decodeJwt(tokens.id_token).email); } catch { /* the email is only shown */ }
        await q(
          `insert into drive_links (account_id, refresh_token, google_email, folder_id, linked_at)
           values ($1, $2, $3, null, now())
           on conflict (account_id) do update
             set refresh_token = excluded.refresh_token, google_email = excluded.google_email,
                 folder_id = null, linked_at = now()`,
          [held.accountId, tokens.refresh_token, googleEmail],
        );
        return bounce({ drive: 'linked' });
      }

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
          [account.id, Number(process.env.TRIAL_SEATS || 2), String(process.env.TRIAL_DAYS || 7)],
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

  /* --- Google Drive backups ------------------------------------------- */

  /** A fresh access token for an account's linked Drive, or null when it is not linked. */
  async function driveToken(accountId) {
    const { rows } = await q('select refresh_token, folder_id from drive_links where account_id = $1', [accountId]);
    if (!rows[0]) return null;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: rows[0].refresh_token, grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      // revoked from the Google account's side: forget it, so the app asks again
      if (res.status === 400 || res.status === 401) await q('delete from drive_links where account_id = $1', [accountId]);
      return null;
    }
    const t = await res.json();
    return { access: t.access_token, folderId: rows[0].folder_id };
  }

  /** The app's backup folder in Drive, made the first time. */
  async function driveFolder(accountId, access, known) {
    const auth = { authorization: 'Bearer ' + access };
    if (known) {
      const check = await fetch('https://www.googleapis.com/drive/v3/files/' + known + '?fields=id,trashed', { headers: auth });
      if (check.ok && !(await check.json()).trashed) return known;
    }
    const made = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
    });
    if (!made.ok) throw new Error('folder ' + made.status);
    const id = (await made.json()).id;
    await q('update drive_links set folder_id = $2 where account_id = $1', [accountId, id]);
    return id;
  }

  /** The app asks for a link to Google's consent page, signed in as the account. */
  app.post('/v1/drive/link', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    sweep();
    const back = String(req.body?.redirect || process.env.APP_RETURN_URL);
    if (!allowedRedirect(back)) return reply.code(400).send({ error: 'malformed', message: 'Bad redirect.' });
    const acct = await q('select email from accounts where id = $1', [me.id]);
    const state = randomBytes(16).toString('base64url');
    pending.set(state, { back, kind: 'drive', accountId: me.id, expires: Date.now() + 10 * 60_000 });
    const url = new URL(AUTH_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email ' + DRIVE_SCOPE);
    url.searchParams.set('access_type', 'offline');
    // a refresh token comes back only when consent is asked for again
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    // the Google account the person registered with is offered first
    if (acct.rows[0]?.email) url.searchParams.set('login_hint', acct.rows[0].email);
    url.searchParams.set('state', state);
    url.searchParams.set('display', 'touch');
    return { url: url.toString() };
  });

  app.get('/v1/drive/status', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const { rows } = await q('select google_email, linked_at, last_backup_at from drive_links where account_id = $1', [me.id]);
    return rows[0]
      ? { linked: true, email: rows[0].google_email, linkedAt: rows[0].linked_at, lastBackupAt: rows[0].last_backup_at }
      : { linked: false };
  });

  app.delete('/v1/drive/link', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    await q('delete from drive_links where account_id = $1', [me.id]);
    return { linked: false };
  });

  /** An encrypted backup from the app, put into the account's Drive folder. */
  app.post('/v1/drive/backup', { bodyLimit: 64 * 1024 * 1024 }, async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const name = String(req.body?.name || '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
    const data = String(req.body?.data || '');
    if (!name || !data) return reply.code(400).send({ error: 'malformed', message: 'No backup was sent.' });
    const tok = await driveToken(me.id);
    if (!tok) return reply.code(409).send({ error: 'driveNotLinked', message: 'Connect Google Drive first.' });
    try {
      const folder = await driveFolder(me.id, tok.access, tok.folderId);
      const boundary = 'gp' + randomBytes(8).toString('hex');
      const meta = JSON.stringify({ name, parents: [folder], mimeType: 'application/octet-stream' });
      const body = Buffer.concat([
        Buffer.from('--' + boundary + '\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n'
          + '--' + boundary + '\r\ncontent-type: application/octet-stream\r\n\r\n'),
        Buffer.from(data, 'base64'),
        Buffer.from('\r\n--' + boundary + '--'),
      ]);
      const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + tok.access, 'content-type': 'multipart/related; boundary=' + boundary },
        body,
      });
      if (!up.ok) {
        req.log.error({ status: up.status }, 'drive upload failed');
        return reply.code(502).send({ error: 'server', message: 'Google Drive did not take the backup. Try again.' });
      }
      const file = await up.json();
      await q('update drive_links set last_backup_at = now() where account_id = $1', [me.id]);
      return { id: file.id, name: file.name, size: Number(file.size || 0), folder: DRIVE_FOLDER };
    } catch (e) {
      req.log.error({ err: e.message }, 'drive backup failed');
      return reply.code(502).send({ error: 'server', message: 'Google Drive could not be reached. Try again.' });
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
