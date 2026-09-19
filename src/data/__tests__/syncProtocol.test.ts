/**
 * The rules in the wire contract that both the app and the server must agree on
 * exactly. Each of these encodes a decision from docs/SYNC_BACKEND.md, and each
 * guards a failure that would be quiet in the field: a replayed sale, a rewound
 * cursor, a till that stops trading because a payment failed in another country.
 */
import {
  buildOp, opOrder, nextCursor, stillPending, isFact,
  licenceVerdict, mayTrade, mayAdminister, LICENCE_GRACE_DAYS,
  type Op, type LicenceClaims,
} from '../syncProtocol';

function ctx(over: Partial<Parameters<typeof buildOp>[0]> = {}) {
  let n = 0;
  return {
    business: 'biz_1',
    device: 'dev_1',
    branch: 'wh_a1',
    user: 'u_3',
    schema: 6,
    lamport: 100,
    newId: () => 'op_' + (++n),
    now: () => new Date('2026-09-18T14:03:11.220Z'),
    ...over,
  };
}

describe('buildOp', () => {
  it('stamps who, where and when', () => {
    const op = buildOp(ctx(), 'sale.commit', { total: 1000 });
    expect(op.business).toBe('biz_1');
    expect(op.branch).toBe('wh_a1');
    expect(op.device).toBe('dev_1');
    expect(op.user).toBe('u_3');
    expect(op.kind).toBe('sale.commit');
    expect(op.ts).toBe('2026-09-18T14:03:11.220Z');
    expect(op.payload).toEqual({ total: 1000 });
  });

  it('gives every operation its own id, so a retry cannot double a sale', () => {
    const c = ctx();
    const a = buildOp(c, 'sale.commit', {});
    const b = buildOp(c, 'sale.commit', {});
    expect(a.opId).not.toBe(b.opId);
  });

  it('carries the schema the payload was written at', () => {
    expect(buildOp(ctx({ schema: 9 }), 'sale.commit', {}).schema).toBe(9);
  });
});

describe('isFact', () => {
  it('treats things that happened as append-only facts', () => {
    expect(isFact('sale.commit')).toBe(true);
    expect(isFact('journal.post')).toBe(true);
    expect(isFact('shift.close')).toBe(true);
  });

  it('does not treat an edited record as one', () => {
    expect(isFact('record.upsert')).toBe(false);
  });
});

describe('opOrder', () => {
  it('follows the server sequence, which is the only real order', () => {
    const sorted = [{ seq: 3 }, { seq: 1 }, { seq: 2 }].sort(opOrder);
    expect(sorted.map((o) => o.seq)).toEqual([1, 2, 3]);
  });

  it('puts anything not yet pushed after everything that has been', () => {
    const local = { opId: 'local', lamport: 5 };
    const sorted = [local, { opId: 'a', seq: 9, lamport: 1 }].sort(opOrder);
    expect(sorted[0].opId).toBe('a');
    expect(sorted[1].opId).toBe('local');
  });

  it('breaks a tie on the device counter, never on the wall clock', () => {
    // two devices whose clocks are minutes apart must not interleave by time
    const a = { opId: 'a', lamport: 2, ts: '2026-01-01T00:10:00Z' };
    const b = { opId: 'b', lamport: 1, ts: '2026-01-01T00:00:00Z' };
    expect([a, b].sort(opOrder).map((o) => o.opId)).toEqual(['b', 'a']);
  });

  it('is stable on a full tie, so two devices sort a batch identically', () => {
    const a = { opId: 'aaa', seq: 1, lamport: 1 };
    const b = { opId: 'bbb', seq: 1, lamport: 1 };
    expect([b, a].sort(opOrder).map((o) => o.opId)).toEqual(['aaa', 'bbb']);
  });
});

describe('nextCursor', () => {
  it('moves to the last operation applied', () => {
    expect(nextCursor(10, [{ seq: 11 }, { seq: 12 }])).toBe(12);
  });

  it('stays put when a pull brings nothing', () => {
    expect(nextCursor(10, [])).toBe(10);
  });

  it('never rewinds, so work already applied is not replayed', () => {
    expect(nextCursor(50, [{ seq: 12 }, { seq: 13 }])).toBe(50);
  });
});

describe('stillPending', () => {
  const q: Op[] = ['a', 'b', 'c'].map((id) => ({
    opId: id, business: 'b', device: 'd', kind: 'sale.commit',
    ts: '', lamport: 0, schema: 6, payload: {},
  }));

  it('drops what the server acknowledged', () => {
    expect(stillPending(q, ['a', 'c']).map((o) => o.opId)).toEqual(['b']);
  });

  it('drops by id, not by position — a push may be acknowledged in part', () => {
    expect(stillPending(q, ['b']).map((o) => o.opId)).toEqual(['a', 'c']);
  });

  it('keeps everything when nothing was accepted', () => {
    expect(stillPending(q, []).length).toBe(3);
  });

  it('is unbothered by an id it has never heard of', () => {
    expect(stillPending(q, ['zzz']).length).toBe(3);
  });
});

describe('licenceVerdict', () => {
  const day = 86400000;
  const base = new Date('2026-09-18T00:00:00Z');
  const claims = (over: Partial<LicenceClaims> = {}): LicenceClaims => ({
    sub: 'acct_1', email: 'owner@example.com', plan: 'pro', term: 'yearly',
    seats: 3, features: [], businesses: ['biz_1'],
    iat: 0, exp: Math.floor((base.getTime() + 10 * day) / 1000), jti: 'j1',
    ...over,
  });

  it('is active inside the token window', () => {
    expect(licenceVerdict(claims(), { now: base })).toBe('active');
  });

  it('names a trial as a trial', () => {
    expect(licenceVerdict(claims({ plan: 'trial' }), { now: base })).toBe('trial');
  });

  it('goes stale, not expired, just past the token window', () => {
    const now = new Date(base.getTime() + 11 * day);
    expect(licenceVerdict(claims(), { now })).toBe('stale');
  });

  it('holds the whole grace window, for a shop that is simply offline', () => {
    const now = new Date(base.getTime() + (10 + LICENCE_GRACE_DAYS) * day - 1000);
    expect(licenceVerdict(claims(), { now })).toBe('stale');
  });

  it('expires once past grace', () => {
    const now = new Date(base.getTime() + (10 + LICENCE_GRACE_DAYS + 1) * day);
    expect(licenceVerdict(claims(), { now })).toBe('expired');
  });

  it('is unbound when the token belongs to a different owner', () => {
    expect(licenceVerdict(claims(), { now: base, accountId: 'acct_other' })).toBe('unbound');
  });

  it('treats a missing token as expired rather than as permission', () => {
    expect(licenceVerdict(null, { now: base })).toBe('expired');
  });
});

describe('what a verdict permits', () => {
  it('lets the shop keep selling in every state but a mismatched book', () => {
    (['active', 'trial', 'stale', 'expired'] as const).forEach((v) => {
      expect(mayTrade(v)).toBe(true);
    });
    expect(mayTrade('unbound')).toBe(false);
  });

  it('stops the admin work once the licence has run out', () => {
    expect(mayAdminister('active')).toBe(true);
    expect(mayAdminister('trial')).toBe(true);
    expect(mayAdminister('stale')).toBe(true);
    expect(mayAdminister('expired')).toBe(false);
    expect(mayAdminister('unbound')).toBe(false);
  });
});
