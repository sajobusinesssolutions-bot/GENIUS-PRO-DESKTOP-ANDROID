/**
 * A disabled branch is closed for everyone, and the money screens read the
 * period asked for.
 */
import { mayRecord } from '../recordGate';
import { accountFlow } from '../accountFlow';

const book = (over: any = {}): any => ({
  session: { warehouse: 'w2', role: 'owner' },
  warehouses: [{ id: 'w1', name: 'Main', active: true }, { id: 'w2', name: 'Town', active: false }],
  licence: { key: '', status: 'none' },
  subscription: { plan: 'pro', status: 'active', trialUntil: '', renewsAt: '' },
  sync: { on: false },
  journal: [],
  ...over,
});

it('refuses to record in a disabled branch, even for the owner', () => {
  const r = mayRecord(book(), true);
  expect(r?.code).toBe('branch');
  expect(r?.title).toMatch(/Town is disabled/);
});

it('records normally in a branch that is trading', () => {
  expect(mayRecord(book({ session: { warehouse: 'w1', role: 'owner' } }), true)?.code).not.toBe('branch');
});

it('splits an account into opening, in, out and closing for a period', () => {
  const day = (n: number) => new Date(2026, 8, n, 12).toISOString();
  const d = book({
    session: { warehouse: 'w1' },
    journal: [
      { id: 'j1', ts: day(1), memo: 'Float', branch: 'w1', lines: [{ acc: 'cash', dr: 1000 }] },
      { id: 'j2', ts: day(10), memo: 'Sale', branch: 'w1', lines: [{ acc: 'cash', dr: 500 }] },
      { id: 'j3', ts: day(10), memo: 'Fuel', branch: 'w1', lines: [{ acc: 'cash', cr: 200 }] },
      { id: 'j4', ts: day(20), memo: 'Later', branch: 'w1', lines: [{ acc: 'cash', dr: 999 }] },
    ],
  });
  const f = accountFlow(d, 'cash', new Date(2026, 8, 5).getTime(), new Date(2026, 8, 15).getTime(), 'w1');
  expect(f.opening).toBe(1000);
  expect(f.inflow).toBe(500);
  expect(f.outflow).toBe(200);
  expect(f.closing).toBe(1300);
  expect(f.days).toHaveLength(1);
  expect(f.days[0].rows).toHaveLength(2);
});
