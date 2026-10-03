/**
 * The developer console's calls to the server.
 *
 * Every one of these is refused by the server unless the signed-in email is
 * listed in DEVELOPER_EMAILS on the box. Nothing here decides who is a
 * developer — the phone only asks, so a copy of the app cannot promote itself.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { SERVER_URL, Result, authError } from './authApi';

async function call<T>(path: string, access: string, body?: unknown, method?: string): Promise<Result<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(SERVER_URL.replace(/[/]$/, '') + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + access },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (res.ok) return { ok: true, value: json as T };
    return { ok: false, error: authError(json?.error || 'server', json?.message) };
  } catch (e: any) {
    return { ok: false, error: authError(e?.name === 'AbortError' ? 'timeout' : 'offline') };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- */

export interface OwnerLicence {
  plan: string; term: string; seats: number;
  status: 'active' | 'trial' | 'expired' | 'blocked' | 'revoked' | string;
  expiresAt: string | null; daysLeft: number | null; since: string;
}

export interface Owner {
  id: string; email: string; name: string;
  blocked: boolean; blockedReason: string | null;
  createdAt: string; lastLoginAt: string | null; lastSeenAt: string | null;
  licence: OwnerLicence | null;
  devices: number;
  businesses: Array<{ id: string; name: string; created: string }>;
  ops: number;
  /** How much of the database this owner's businesses take up. */
  bytes: number;
}

export interface Reports {
  totals: {
    owners: number; businesses: number; paying: number; trial: number;
    expired: number; expiringSoon: number; blocked: number; bytes: number;
  };
  expired: Owner[]; expiringSoon: Owner[]; trial: Owner[]; blocked: Owner[];
  soonDays: number;
}

export interface ServerStats {
  at: string;
  machine: {
    cpus: number; load: number[]; memTotal: number; memFree: number; uptime: number;
    disk: { total: number; free: number } | null;
  };
  process: { uptime: number; rss: number; heapUsed: number; loopLagMs: number; loopLagP99Ms: number };
  requests: {
    perMinute: number; avgMs: number; p95Ms: number; errors5m: number;
    history: Array<{ t: number; n: number; avgMs: number; errors: number }>;
  };
  database: {
    size: number; connections: number; active: number; max_connections: number; cache_hit: number | null;
    tables: Array<{ name: string; bytes: number; rows: number }>;
  };
}

export interface Backup { name: string; bytes: number; at: string }

/** One problem a phone reported (server/src/crash.js). */
export interface CrashRow {
  id: number; received_at: string; happened_at: string | null; fatal: boolean; kind: string | null;
  message: string; stack: string | null; route: string | null; app_version: string | null;
  platform: string | null; os_version: string | null; device: string | null; business_id: string | null; email: string | null;
}
export interface Crashes { reports: CrashRow[]; top: Array<{ message: string; n: number; last: string; fatal: boolean }> }
export const listCrashes = (a: string) => call<Crashes>('/v1/admin/crashes?limit=100', a);

export const isDeveloper = (a: string) => call<{ developer: boolean }>('/v1/admin/me', a);
export const listOwners = (a: string) => call<{ owners: Owner[] }>('/v1/admin/owners', a);
export const getReports = (a: string) => call<Reports>('/v1/admin/reports', a);
export const getServer = (a: string) => call<ServerStats>('/v1/admin/server', a);
export const listBackups = (a: string) => call<{ backups: Backup[]; dir: string; keep: number }>('/v1/admin/backups', a);
export const runBackup = (a: string) => call<{ ok: true; backup: Backup & { ms: number } }>('/v1/admin/backups', a, {});

/** `days: null` grants a lifetime licence. */
/** Adds an owner by email with a subscription, and emails them how to get in. */
export const addOwner = (a: string, o: { email: string; name?: string; plan: string; days: number | null; seats: number; invite: boolean }) =>
  call<{ ok: true; id: string; created: boolean; invited: boolean; inviteError: string | null }>('/v1/admin/owners', a, o);

export const grantLicence = (a: string, ownerId: string, o: { plan: string; days: number | null; seats: number }) =>
  call<{ ok: true }>('/v1/admin/owners/' + ownerId + '/licence', a, o);

export const setBlocked = (a: string, ownerId: string, blocked: boolean, reason?: string) =>
  call<{ ok: true }>('/v1/admin/owners/' + ownerId + '/block', a, { blocked, reason });

/**
 * Brings a dump down to the phone and hands it to the share sheet.
 *
 * The whole point of a backup is that it lives somewhere other than the server
 * it protects, and the dumps are written on that server. Sharing one to Drive,
 * email or a laptop is what makes it survive losing the box.
 */
export async function downloadAndShare(access: string, b: Backup): Promise<Result<true>> {
  try {
    const dest = new File(Paths.cache, b.name);
    if (dest.exists) dest.delete();
    await File.downloadFileAsync(
      SERVER_URL.replace(/[/]$/, '') + '/v1/admin/backups/' + encodeURIComponent(b.name),
      dest,
      { headers: { authorization: 'Bearer ' + access } },
    );
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, error: authError('server', 'Sharing is not available on this phone.') };
    }
    await Sharing.shareAsync(dest.uri, { mimeType: 'application/octet-stream', dialogTitle: b.name });
    return { ok: true, value: true };
  } catch (e: any) {
    return { ok: false, error: authError('server', e?.message || 'The download failed.') };
  }
}

/* ---------------------------------------------------------------- */

export function bytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** i).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
}

export function ago(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  if (s < 86400 * 45) return Math.round(s / 86400) + ' days ago';
  return new Date(iso).toLocaleDateString('en-GB');
}

export function duration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm';
}
