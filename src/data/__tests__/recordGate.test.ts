/**
 * Whether a transaction may be saved, and what the operator is told when it may
 * not. Both halves matter: a till that refuses without a reason leaves someone
 * standing at a counter with a customer and no idea what to do.
 */
import { mayRecord, canRecord, refusalMessage } from '../recordGate';

function book(over: any = {}): any {
  return {
    licence: { key: 'K-1', status: 'active', checkedAt: new Date().toISOString(), licence: null, server: '', reason: '', offlineSince: '' },
    sync: { on: false },
    ...over,
  };
}

describe('a working licence', () => {
  it('lets a transaction through when the licence is active', () => {
    expect(mayRecord(book(), true)).toBeNull();
    expect(canRecord(book(), true)).toBe(true);
  });

  it('lets a trial through too', () => {
    const d = book({ licence: { key: 'K', status: 'trial', checkedAt: new Date().toISOString(), licence: null, server: '', reason: '', offlineSince: '' } });
    expect(mayRecord(d, true)).toBeNull();
  });
});

describe('a licence that has run out', () => {
  function expired(status: string) {
    return book({ licence: { key: 'K', status, checkedAt: new Date().toISOString(), licence: null, server: '', reason: '', offlineSince: '' } });
  }

  it('blocks a new transaction', () => {
    expect(canRecord(expired('expired'), true)).toBe(false);
  });

  it('says it is the licence, and says what still works', () => {
    const r = mayRecord(expired('expired'), true)!;
    expect(r.code).toBe('licence');
    expect(r.title).toBe('The licence has run out');
    expect(r.why).toMatch(/read, printed and backed up/);
  });

  it('sends the person somewhere they can fix it', () => {
    expect(mayRecord(expired('expired'), true)!.route).toBe('Licence');
  });

  it('gives each reason its own words, not one generic refusal', () => {
    const words = ['expired', 'blocked', 'revoked', 'toomany', 'invalid']
      .map((s) => mayRecord(expired(s), true)!.title);
    expect(new Set(words).size).toBe(words.length);
  });

  it('does not block a device that has simply never checked yet', () => {
    // a brand-new shop was being told to enter a licence while the server had
    // already given it a trial; never having asked is not having run out
    const d = book({ licence: { key: '', status: 'none', checkedAt: '', licence: null, server: '', reason: '', offlineSince: '' } });
    expect(canRecord(d, true)).toBe(true);
  });

  it('blocks even while online — a connection is not a licence', () => {
    expect(canRecord(expired('revoked'), true)).toBe(false);
  });
});

describe('sync switched on', () => {
  const synced = (online: boolean) => mayRecord(book({ sync: { on: true } }), online);

  it('lets a transaction through while the phone is online', () => {
    expect(synced(true)).toBeNull();
  });

  it('blocks it while the phone is offline', () => {
    expect(synced(false)!.code).toBe('offline');
  });

  it('explains that this is what switching sync on means', () => {
    const r = synced(false)!;
    expect(r.title).toBe('No connection');
    expect(r.why).toMatch(/tills stay in step/);
    expect(r.why).toMatch(/switch sync off/);
  });

  it('points at the sync settings, where it can be changed', () => {
    expect(synced(false)!.route).toBe('Sync');
  });
});

describe('sync switched off', () => {
  it('does not care whether the phone is online', () => {
    expect(mayRecord(book({ sync: { on: false } }), false)).toBeNull();
  });

  it('is unbothered by a book with no sync settings at all', () => {
    expect(mayRecord(book({ sync: undefined }), false)).toBeNull();
  });
});

describe('accounting period lock', () => {
  it('blocks new records while the current period is locked', () => {
    const d = book({
      settings: { accountLock: null, accountingLock: { from: '2026-09-01T00:00:00.000Z', reason: 'Month end close', lockedAt: '2026-09-20T00:00:00.000Z' } },
    });
    expect(mayRecord(d, true)!.code).toBe('period_lock');
    expect(mayRecord(d, true)!.route).toBe('Accounting');
  });
});

describe('when both would refuse', () => {
  it('names the licence first — it is the one being offline cannot fix', () => {
    const d = book({
      licence: { key: 'K', status: 'expired', checkedAt: new Date().toISOString(), licence: null, server: '', reason: '', offlineSince: '' },
      sync: { on: true },
    });
    expect(mayRecord(d, false)!.code).toBe('licence');
  });
});

describe('refusalMessage', () => {
  it('carries both the headline and the reason, since a thrown error is one line', () => {
    const r = mayRecord(book({ sync: { on: true } }), false)!;
    const m = refusalMessage(r);
    expect(m.startsWith('No connection — ')).toBe(true);
    expect(m).toMatch(/Reconnect and try again/);
  });
});
