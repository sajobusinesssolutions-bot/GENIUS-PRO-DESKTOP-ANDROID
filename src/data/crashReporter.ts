/**
 * CRASH AND ERROR REPORTS.
 *
 * When something breaks on a phone, what broke is written down and sent to
 * the account server (POST /v1/crash), where the developer console lists it:
 * the error and where in the code, the screen it happened on, the phone model,
 * Android version and app version. Problems are then found from the report,
 * not guessed at from a description.
 *
 * Reports wait in a small queue on the phone and go when there is a
 * connection, so a crash with no signal is not lost. A Refusal ("the trial
 * has ended", "not allowed for your role") is the app working as meant and is
 * never reported.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { SERVER_URL, serverConfigured } from './authApi';
import { BUILD } from './defaults';

const KEY = 'genius.crashQueue';
const MAX_QUEUE = 30;

export interface CrashReport {
  at: string; kind: 'crash' | 'error' | 'render'; fatal: boolean;
  message: string; stack?: string; route?: string;
  appVersion: string; platform: string; osVersion: string; device: string;
  businessId?: string; extra?: Record<string, unknown>;
}

/* What the app knows about who and where it is, kept current by <CrashContext/>. */
const ctx: { accountId?: string; businessId?: string; access?: () => Promise<string | null> } = {};
export function setCrashContext(c: typeof ctx) { Object.assign(ctx, c); }

function device(): string {
  const k: any = Platform.constants || {};
  return [k.Manufacturer || k.Brand, k.Model].filter(Boolean).join(' ') || Platform.OS;
}

function route(): string | undefined {
  try { return require('../nav/RootNavigator').navRef?.getCurrentRoute?.()?.name; } catch { return undefined; }
}

const isRefusal = (e: any) => e?.name === 'Refusal';

function build(e: unknown, kind: CrashReport['kind'], fatal: boolean, extra?: Record<string, unknown>): CrashReport {
  const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e));
  const k: any = Platform.constants || {};
  return {
    at: new Date().toISOString(), kind, fatal,
    message: (err.name && err.name !== 'Error' ? err.name + ': ' : '') + String(err.message || err).slice(0, 2000),
    stack: String(err.stack || '').slice(0, 16000),
    route: route(),
    appVersion: (Constants.expoConfig?.version || '') + ' · ' + BUILD,
    platform: Platform.OS,
    osVersion: String(k.Release || Platform.Version || ''),
    device: device(),
    businessId: ctx.businessId,
    extra: { ...(extra || {}), accountId: ctx.accountId },
  };
}

async function readQueue(): Promise<CrashReport[]> {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) || '[]'); } catch { return []; }
}
async function writeQueue(q: CrashReport[]) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(q.slice(-MAX_QUEUE))); } catch { /* storage full: drop */ }
}

let sending = false;
/** Sends whatever is waiting. Quiet on failure: it tries again next time. */
export async function flushCrashReports(): Promise<void> {
  if (sending || !serverConfigured()) return;
  sending = true;
  try {
    const q = await readQueue();
    if (!q.length) return;
    let token: string | null = null;
    try { token = ctx.access ? await ctx.access() : null; } catch { token = null; }
    const res = await fetch(SERVER_URL.replace(/[/]$/, '') + '/v1/crash', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : null) },
      body: JSON.stringify({ reports: q.slice(0, 20) }),
    });
    if (res.ok) await writeQueue((await readQueue()).slice(q.slice(0, 20).length));
  } catch { /* offline: keep them */ } finally {
    sending = false;
  }
}

/** Records a problem and tries to send it. Safe to call from anywhere; never throws. */
export async function reportError(e: unknown, opts: { kind?: CrashReport['kind']; fatal?: boolean; extra?: Record<string, unknown> } = {}) {
  try {
    if (isRefusal(e)) return;
    const q = await readQueue();
    q.push(build(e, opts.kind || 'error', !!opts.fatal, opts.extra));
    await writeQueue(q);
    void flushCrashReports();
  } catch { /* reporting must never cause a second crash */ }
}

let installed = false;
/** Catches every uncaught error and unhandled promise rejection. Call once, early. */
export function installCrashReporting() {
  if (installed) return;
  installed = true;
  const EU = (global as any).ErrorUtils;
  if (EU && typeof EU.getGlobalHandler === 'function') {
    const previous = EU.getGlobalHandler();
    EU.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      if (!isRefusal(error)) void reportError(error, { kind: 'crash', fatal: !!isFatal });
      previous?.(error, isFatal);
    });
  }
  const H = (global as any).HermesInternal;
  try {
    H?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id: number, err: unknown) => { void reportError(err, { kind: 'error', extra: { unhandledPromise: true } }); },
    });
  } catch { /* not on this engine */ }
  // anything left from a crash that closed the app last time
  setTimeout(() => { void flushCrashReports(); }, 5000);
}
