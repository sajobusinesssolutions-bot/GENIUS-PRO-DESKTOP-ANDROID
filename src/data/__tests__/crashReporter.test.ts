/**
 * What goes into a crash report, and what never does.
 */
const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (k: string) => store[k] ?? null,
  setItem: async (k: string, v: string) => { store[k] = v; },
}));
jest.mock('../authApi', () => ({ SERVER_URL: 'https://api.example.test', serverConfigured: () => true }));
jest.mock('../../nav/RootNavigator', () => ({ navRef: { getCurrentRoute: () => ({ name: 'Receipt' }) } }));

import { reportError, flushCrashReports, setCrashContext } from '../crashReporter';
import { Refusal } from '../refusal';

const queued = () => JSON.parse(store['genius.crashQueue'] || '[]');
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

it('sends a real error with where and on what it happened, then clears it', async () => {
  const sent: any[] = [];
  (global as any).fetch = jest.fn(async (_u: string, init: any) => { sent.push(JSON.parse(init.body)); return { ok: true }; });
  setCrashContext({ accountId: 'acct-1', businessId: 'biz-1' });
  await reportError(new TypeError('cannot read property total of undefined'), { extra: { where: 'autoPrint' } });
  await flush(); await flushCrashReports();
  const r = sent[0].reports[0];
  expect(r.message).toBe('TypeError: cannot read property total of undefined');
  expect(r.stack).toContain('TypeError');
  expect(r.businessId).toBe('biz-1');
  expect(r.route).toBe('Receipt');
  expect(r.extra).toMatchObject({ where: 'autoPrint', accountId: 'acct-1' });
  expect(r.appVersion).toBeTruthy();
  expect(queued()).toEqual([]);
});

it('never reports a refusal, which is the app working as meant', async () => {
  (global as any).fetch = jest.fn(async () => ({ ok: true }));
  await reportError(new Refusal('Your free trial has ended', 'Choose a plan.'));
  expect(queued()).toEqual([]);
  expect((global as any).fetch).not.toHaveBeenCalled();
});

it('keeps a report when there is no connection, to send later', async () => {
  (global as any).fetch = jest.fn(async () => { throw new Error('Network request failed'); });
  await reportError(new Error('boom'));
  await flush();
  expect(queued().map((r: any) => r.message)).toEqual(['boom']);
});
