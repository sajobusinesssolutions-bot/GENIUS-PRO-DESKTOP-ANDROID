/**
 * Sending the six-digit codes.
 *
 * If SMTP is not configured the send *fails loudly* rather than pretending to
 * work. A signup flow that says "check your email" when nothing was sent leaves
 * someone waiting for a code that will never arrive, and the address they were
 * confirming is their only route back into the account.
 */
import nodemailer from 'nodemailer';

let transport = null;

export function mailConfigured() {
  const pass = process.env.SMTP_PASS || '';
  return Boolean(process.env.SMTP_HOST && pass && pass !== 'CHANGE_ME');
}

function get() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}

const PURPOSE_WORDS = {
  signup: 'confirm your email address',
  reset: 'reset your password',
  pin: 'reset your owner PIN',
};

export async function sendCode(email, code, purpose) {
  if (!mailConfigured()) {
    const e = new Error('mail_not_configured');
    e.expose = true;
    throw e;
  }

  const what = PURPOSE_WORDS[purpose] || 'continue';
  const minutes = Math.round(Number(process.env.OTP_TTL || 600) / 60);

  await get().sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: `${code} is your Genius POS code`,
    text:
      `Your code is ${code}\n\n`
      + `Enter it in the app to ${what}. It expires in ${minutes} minutes.\n\n`
      + `If you did not ask for this, you can ignore this email — `
      + `nobody can use the code without it.\n`,
    html:
      `<div style="font-family:system-ui,sans-serif;max-width:420px">`
      + `<p style="font-size:15px;color:#333">Your Genius POS code is</p>`
      + `<p style="font-size:34px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>`
      + `<p style="font-size:14px;color:#555">Enter it in the app to ${what}. `
      + `It expires in ${minutes} minutes.</p>`
      + `<p style="font-size:13px;color:#888">If you did not ask for this you can ignore `
      + `this email — nobody can use the code without it.</p></div>`,
  });
}

/**
 * Tells somebody the developer has opened an account for them, and how to get
 * in: the account has no password yet, so it is Google, or "Forgot password".
 */
export async function sendInvite(email, { plan, until }) {
  if (!mailConfigured()) {
    const e = new Error('mail_not_configured');
    e.expose = true;
    throw e;
  }
  const what = plan === 'trial' ? 'a trial of Genius POS' : 'a Genius POS ' + plan + ' subscription';
  const when = until ? ' It runs until ' + new Date(until).toDateString() + '.' : '';
  await get().sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: 'Your Genius POS account is ready',
    text:
      `An account has been opened for ${email} with ${what}.${when}\n\n`
      + `To get in: open the Genius POS app and choose "Continue with Google" with this address, `
      + `or choose "Forgot password" to set a password by email.\n`,
    html:
      `<div style="font-family:system-ui,sans-serif;max-width:440px">`
      + `<p style="font-size:16px;color:#222;font-weight:600">Your Genius POS account is ready</p>`
      + `<p style="font-size:14px;color:#444">An account has been opened for <b>${email}</b> with ${what}.${when}</p>`
      + `<p style="font-size:14px;color:#444">To get in, open the app and choose <b>Continue with Google</b> `
      + `with this address, or choose <b>Forgot password</b> to set a password by email.</p></div>`,
  });
}

/** Proves the credentials work, so a misconfiguration is found at boot. */
export async function verifyMail() {
  if (!mailConfigured()) return { ok: false, why: 'not configured' };
  try {
    await get().verify();
    return { ok: true, why: '' };
  } catch (e) {
    return { ok: false, why: e.message };
  }
}
