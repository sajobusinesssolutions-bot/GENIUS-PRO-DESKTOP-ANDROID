/**
 * Which addresses the server is willing to hand a sign-in ticket to.
 *
 * Kept on its own, with no imports, so the rule that stops
 * /v1/auth/google/start becoming an open redirector can be tested without
 * standing up a database and a mail transport.
 */

/**
 * Two things can legitimately receive a ticket:
 *
 *  · `geniuspos://` — the app's own scheme, in a development or standalone
 *    build. Nothing else on the phone answers to it.
 *  · `exp://` — Expo Go, which does not register custom schemes at all, so
 *    during development the redirect has to come back through Expo's own.
 *    Allowed **only to a private address**: `exp://` will happily open Expo Go
 *    pointed at any host on the internet, and an unrestricted version of this
 *    would let somebody have a ticket delivered to a machine of their choosing.
 *
 * Anything else is refused, so this cannot be used to bounce a person to an
 * arbitrary site.
 */
export function allowedRedirect(back) {
  const url = String(back || '');
  if (url.startsWith('geniuspos://')) return true;
  if (!url.startsWith('exp://')) return false;

  const host = (url.split('://')[1] || '').split('/')[0].split(':')[0];
  if (host === 'localhost' || host === '127.0.0.1') return true;

  const p = host.split('.');
  if (p.length !== 4) return false;
  const n = p.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : -1));
  if (n.some((x) => x < 0 || x > 255)) return false;

  if (n[0] === 10) return true;
  if (n[0] === 192 && n[1] === 168) return true;
  if (n[0] === 172 && n[1] >= 16 && n[1] <= 31) return true;
  return false;
}
