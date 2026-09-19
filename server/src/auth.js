/**
 * Accounts: creating one, getting back into one, and the Google route.
 *
 * The account is the owner's email address. It holds the licence, it owns the
 * businesses, and it is the only way back in when a phone is lost — which is
 * why the address is confirmed with a code before an account exists at all,
 * rather than afterwards.
 *
 * Every failure is answered with one of the codes the app's `AuthFailure` union
 * knows, so the person reads a sentence about their situation rather than a
 * stack trace.
 */
import argon2 from 'argon2';
import { createHash, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import { q, tx } from './db.js';
import { sendCode, mailConfigured } from './mail.js';
import { issueAccess, newRefresh, hashRefresh, refreshMatches } from './tokens.js';

const OTP_TTL = Number(process.env.OTP_TTL || 600);
const MAX_OTP_TRIES = 5;

const fail = (reply, status, error, message) =>
  reply.code(status).send({ error, message });

const hashCode = (code) => createHash('sha256').update(String(code)).digest('hex');

/** Six digits from a real random source, not Math.random. */
const sixDigits = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

const normalise = (e) => String(e || '').trim().toLowerCase();

/* ---------------------------------------------------------------- */

async function issueSession(account, deviceName = 'unknown') {
  const refresh = newRefresh();
  await q(
    `insert into devices (account_id, name, kind, platform, refresh_hash, last_seen)
     values ($1, $2, 'phone', $3, $4, now())`,
    [account.id, deviceName, 'app', hashRefresh(refresh)],
  );
  return {
    accountId: account.id,
    email: account.email,
    name: account.name || '',
    access: await issueAccess(account),
    refresh,
  };
}

/**
 * Stores a code and emails it.
 *
 * Any code already outstanding for this address and purpose is spent first, so
 * asking for a new one genuinely replaces the old rather than leaving several
 * valid at once.
 */
async function startCode(email, purpose) {
  const code = sixDigits();
  await q(
    `update otps set used_at = now()
      where email = $1 and purpose = $2 and used_at is null`,
    [email, purpose],
  );
  await q(
    `insert into otps (email, purpose, code_hash, expires_at)
     values ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
    [email, purpose, hashCode(code), String(OTP_TTL)],
  );
  await sendCode(email, code, purpose);
}

/** Spends a code. Returns why it was refused, or null when it was good. */
async function spendCode(email, purpose, code) {
  const { rows } = await q(
    `select id, code_hash, tries, expires_at
       from otps
      where email = $1 and purpose = $2 and used_at is null
      order by created_at desc limit 1`,
    [email, purpose],
  );
  const otp = rows[0];
  if (!otp) return 'badCode';
  if (new Date(otp.expires_at) < new Date()) return 'codeExpired';
  if (otp.tries >= MAX_OTP_TRIES) return 'rateLimited';

  const given = Buffer.from(hashCode(code), 'hex');
  const held = Buffer.from(otp.code_hash, 'hex');
  const ok = given.length === held.length && timingSafeEqual(given, held);

  if (!ok) {
    // counted, so a six-digit code cannot simply be guessed through
    await q('update otps set tries = tries + 1 where id = $1', [otp.id]);
    return 'badCode';
  }
  await q('update otps set used_at = now() where id = $1', [otp.id]);
  return null;
}

/* ---------------------------------------------------------------- routes */

export default async function authRoutes(app) {
  /* --- ask for a code ------------------------------------------------- */
  app.post('/v1/auth/otp/request', async (req, reply) => {
    const email = normalise(req.body?.email);
    const purpose = req.body?.purpose === 'reset' ? 'reset' : 'signup';
    if (!email.includes('@')) return fail(reply, 400, 'malformed', 'That email address does not look right.');
    if (!mailConfigured()) {
      return fail(reply, 503, 'server',
        'This server cannot send email yet, so a code cannot be sent. Contact whoever set it up.');
    }

    const { rows } = await q('select id from accounts where email = $1', [email]);
    const exists = rows.length > 0;

    if (purpose === 'signup' && exists) {
      return fail(reply, 409, 'emailTaken',
        'There is already an account with that email. Sign in instead, or reset the password.');
    }
    if (purpose === 'reset' && !exists) {
      // Said plainly. Hiding it would be theatre: the signup route already
      // reveals whether an address is taken, so pretending here protects nobody.
      return fail(reply, 404, 'unknownEmail', 'No account was found with that email address.');
    }

    try {
      await startCode(email, purpose);
    } catch (e) {
      req.log.error({ err: e.message }, 'otp send failed');
      return fail(reply, 502, 'server', 'The code could not be sent. Try again in a moment.');
    }
    return { sent: true };
  });

  /* --- create the account --------------------------------------------- */
  app.post('/v1/auth/register', async (req, reply) => {
    const email = normalise(req.body?.email);
    const { name, phone, code, password } = req.body || {};
    if (!email.includes('@') || !name || !password) {
      return fail(reply, 400, 'malformed', 'Name, email and password are all needed.');
    }
    if (String(password).length < 8) {
      return fail(reply, 400, 'malformed', 'Use at least 8 characters for the password.');
    }

    const why = await spendCode(email, 'signup', code);
    if (why) {
      return fail(reply, 400, why,
        why === 'codeExpired' ? 'That code has expired. Ask for a new one.'
          : why === 'rateLimited' ? 'Too many attempts. Ask for a new code.'
            : 'That code is not right.');
    }

    try {
      const account = await tx(async (c) => {
        const hash = await argon2.hash(String(password), { type: argon2.argon2id });
        const { rows } = await c.query(
          `insert into accounts (email, password_hash, name, phone, email_verified)
           values ($1, $2, $3, $4, true) returning id, email, name`,
          [email, hash, String(name).trim(), phone || null],
        );
        const acct = rows[0];
        // every new account starts on a trial, so the app has a licence to read
        await c.query(
          `insert into licences (account_id, plan, term, seats, status, expires_at)
           values ($1, 'trial', 'monthly', $2, 'trial', now() + ($3 || ' days')::interval)`,
          [acct.id, Number(process.env.TRIAL_SEATS || 2), String(process.env.TRIAL_DAYS || 30)],
        );
        return acct;
      });
      return issueSession(account, req.body?.device || 'first device');
    } catch (e) {
      if (e.code === '23505') {
        return fail(reply, 409, 'emailTaken', 'There is already an account with that email.');
      }
      req.log.error({ err: e.message }, 'register failed');
      return fail(reply, 500, 'server', 'The account could not be created. Try again.');
    }
  });

  /* --- sign in --------------------------------------------------------- */
  app.post('/v1/auth/login', async (req, reply) => {
    const email = normalise(req.body?.email);
    const password = String(req.body?.password || '');

    const { rows } = await q(
      'select id, email, name, password_hash, status from accounts where email = $1',
      [email],
    );
    const account = rows[0];

    // The same answer whether the address is unknown or the password is wrong,
    // so this endpoint cannot be used to find out who has an account.
    const no = () => fail(reply, 401, 'badCredentials',
      'That email and password do not match. Try again, or reset the password by email.');

    if (!account || !account.password_hash) return no();
    if (account.status !== 'active') {
      return fail(reply, 403, 'server', 'This account is not active. Contact support.');
    }
    let ok = false;
    try { ok = await argon2.verify(account.password_hash, password); } catch { ok = false; }
    if (!ok) return no();

    return issueSession(account, req.body?.device || 'a device');
  });

  /* --- reset the password ---------------------------------------------- */
  app.post('/v1/auth/password/reset', async (req, reply) => {
    const email = normalise(req.body?.email);
    const { code, password } = req.body || {};
    if (String(password || '').length < 8) {
      return fail(reply, 400, 'malformed', 'Use at least 8 characters for the password.');
    }

    const why = await spendCode(email, 'reset', code);
    if (why) {
      return fail(reply, 400, why,
        why === 'codeExpired' ? 'That code has expired. Ask for a new one.' : 'That code is not right.');
    }

    const hash = await argon2.hash(String(password), { type: argon2.argon2id });
    const { rows } = await q(
      `update accounts set password_hash = $2, email_verified = true
        where email = $1 returning id, email, name`,
      [email, hash],
    );
    if (!rows[0]) return fail(reply, 404, 'unknownEmail', 'No account was found with that email.');

    // Every other session is ended: a password reset is how someone recovers an
    // account that may have been taken, and leaving old sessions alive would
    // defeat the point of resetting it.
    await q('update devices set revoked_at = now() where account_id = $1 and revoked_at is null', [rows[0].id]);
    return issueSession(rows[0], req.body?.device || 'a device');
  });

  /* --- refresh --------------------------------------------------------- */
  app.post('/v1/auth/refresh', async (req, reply) => {
    const token = String(req.body?.refresh || '');
    if (!token) return fail(reply, 400, 'malformed', 'No refresh token was sent.');

    const { rows } = await q(
      `select d.id as device_id, d.refresh_hash, a.id, a.email, a.name
         from devices d join accounts a on a.id = d.account_id
        where d.refresh_hash = $1 and d.revoked_at is null`,
      [hashRefresh(token)],
    );
    const row = rows[0];
    if (!row || !refreshMatches(token, row.refresh_hash)) {
      return fail(reply, 401, 'badCredentials', 'Please sign in again.');
    }
    await q('update devices set last_seen = now() where id = $1', [row.device_id]);
    return { access: await issueAccess({ id: row.id, email: row.email }) };
  });
}

export { normalise, issueSession };
