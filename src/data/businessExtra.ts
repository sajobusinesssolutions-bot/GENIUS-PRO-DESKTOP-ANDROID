/**
 * Your businesses, beyond the list: vouchers this week and when each was last
 * used (server businessextra.js), and renaming one. An older server without
 * these answers nothing, and the screen simply leaves them out.
 */
import { SERVER_URL } from './authApi';

export interface BusinessExtra { id: string; vouchersWeek: number; lastActivity: string | null }

export async function businessExtras(token: string): Promise<Record<string, BusinessExtra>> {
  try {
    const res = await fetch(SERVER_URL + '/v1/businesses/extra', { headers: { authorization: 'Bearer ' + token } });
    if (!res.ok) return {};
    const j = await res.json();
    return Object.fromEntries(((j.businesses || []) as BusinessExtra[]).map((b) => [b.id, b]));
  } catch { return {}; }
}

export async function renameBusiness(token: string, id: string, name: string): Promise<{ ok: true } | { ok: false; why: string }> {
  try {
    const res = await fetch(SERVER_URL + '/v1/businesses/' + id + '/rename', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ name }),
    });
    if (res.ok) return { ok: true };
    const j = await res.json().catch(() => ({}));
    return { ok: false, why: j.message || (res.status === 404 ? 'The account server has not been updated for renaming yet.' : 'It could not be renamed just now.') };
  } catch { return { ok: false, why: "Can't connect to the internet. Check your connection." }; }
}
