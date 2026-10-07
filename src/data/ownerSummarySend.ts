/**
 * Sending the owner's day summary: by email through the server, which needs
 * nobody to tap anything, and on WhatsApp, which WhatsApp itself only lets a
 * person send (it opens with the text ready; the owner's own number can be
 * the business's WhatsApp, so the message lands in their chat).
 */
import type { DB } from './types';
import { daySummary } from './daySummary';
import { emailSummary } from './syncClient';
import { refreshSession } from './authApi';
import { sendVia } from './messages';

export const todayKey = (now = new Date()) =>
  now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

/** Past the hour set for today's summary, and not yet emailed today. */
export function summaryDue(d: DB, now = new Date()): boolean {
  return pastHour(d, now) && d.settings.ownerSummarySentOn !== todayKey(now);
}

/** Switched on, and past the hour set for it. */
export function pastHour(d: DB, now = new Date()): boolean {
  const o = d.settings.ownerSummary;
  if (!o?.on) return false;
  const [h, m] = (o.time || '20:00').split(':').map(Number);
  return now.getHours() * 60 + now.getMinutes() >= (h || 0) * 60 + (m || 0);
}

export const summarySubject = (d: DB, now = new Date()) =>
  (d.firm?.name || 'Your business') + ' — ' + now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' summary';

/** Emails today's summary to the owner's address. Gives the reason when it cannot. */
export async function emailToday(d: DB, money: (n: number) => string, refresh: string | undefined, to?: string): Promise<{ ok: true } | { ok: false; why: string }> {
  const address = (to || d.settings.ownerSummary?.email || '').trim();
  if (!address) return { ok: false, why: 'Add the owner\'s email address first.' };
  if (!refresh) return { ok: false, why: 'Sign in to your Genius Pro account to send by email.' };
  const s = await refreshSession(refresh);
  if (!s.ok) return { ok: false, why: 'Could not reach the server. Check the internet connection.' };
  const r = await emailSummary(s.value.access, address, summarySubject(d), daySummary(d, money));
  return r.ok ? { ok: true } : { ok: false, why: r.error.message };
}

/** Opens WhatsApp with today's summary ready for the owner's number. */
export function whatsappToday(d: DB, money: (n: number) => string) {
  return sendVia('whatsapp', { text: daySummary(d, money), phone: d.settings.ownerSummary?.whatsapp || d.firm?.phone });
}
