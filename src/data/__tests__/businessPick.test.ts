/**
 * Choosing a business after signing in.
 *
 * Wiring used to take the account's first business whatever the phone held,
 * so a phone that opened a second shop would have sent its work into the first.
 */
jest.mock('../authApi', () => ({
  SERVER_URL: 'https://api.example.com',
  serverConfigured: () => true,
  authError: (failure: string, message?: string) => ({ failure, message: message || failure }),
}));

import { ensureWiring } from '../syncClient';

const list = [
  { id: 'biz-first', local_id: 'firm-a' },
  { id: 'biz-second', local_id: 'firm-b' },
];

function mockServer() {
  const calls: string[] = [];
  (global as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push((init?.method || 'GET') + ' ' + url.replace('https://api.example.com', ''));
    const body = url.endsWith('/v1/businesses') && init?.method === 'GET'
      ? { businesses: list }
      : url.endsWith('/v1/devices') ? { deviceId: 'dev-1' } : { id: 'biz-new' };
    return { ok: true, text: async () => JSON.stringify(body) };
  });
  return calls;
}

const book = (over: any) => ({ firm: { id: 'firm-x', name: 'Shop' }, session: { till: 'Till 1' }, sync: {}, ...over });

it('keeps the business chosen from the list', async () => {
  mockServer();
  const r = await ensureWiring(book({ sync: { businessId: 'biz-second' } }) as any, 'token');
  expect(r.ok && r.value.businessId).toBe('biz-second');
});

it('finds the books\' own business by the shop id', async () => {
  mockServer();
  const r = await ensureWiring(book({ firm: { id: 'firm-b', name: 'B' } }) as any, 'token');
  expect(r.ok && r.value.businessId).toBe('biz-second');
});

it('makes a new business for books the account has never seen, rather than borrowing another', async () => {
  const calls = mockServer();
  const r = await ensureWiring(book({}) as any, 'token');
  expect(r.ok && r.value.businessId).toBe('biz-new');
  expect(calls).toContain('POST /v1/businesses');
});
