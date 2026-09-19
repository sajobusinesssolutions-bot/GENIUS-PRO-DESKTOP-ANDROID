import {
  ensureCoa, ledgerBalance, ledgerBalances, ledgerHistory, trialBalance, debitPositive, LedgerType,
} from '../coa';

function makeBook(): any {
  return {
    accounts: [
      { id: 'acc_cash', name: 'Cash drawer', type: 'cash', opening: 0 },
      { id: 'acc_bank', name: 'Bank', type: 'bank', opening: 0 },
    ],
    journal: [],
    coa: undefined,
  };
}

function post(d: any, ts: string, memo: string, lines: Array<{ acc: string; dr?: number; cr?: number }>) {
  d.journal.push({ id: 'j' + d.journal.length, ts, memo, ref: 'T', lines, balanced: true });
}

describe('ensureCoa', () => {
  it('builds a chart from the built-ins and the shop accounts', () => {
    const d = makeBook();
    const coa = ensureCoa(d);
    expect(coa.some((l) => l.id === 'n_sales')).toBe(true);
    expect(coa.some((l) => l.id === 'acc_cash')).toBe(true);
    expect(coa.find((l) => l.id === 'acc_cash')!.type).toBe('asset');
  });

  it('adopts a ledger that only exists because something posted to it', () => {
    const d = makeBook();
    post(d, '2026-01-01', 'Odd', [{ acc: 'n_mystery', dr: 10 }, { acc: 'acc_cash', cr: 10 }]);
    const coa = ensureCoa(d);
    expect(coa.some((l) => l.id === 'n_mystery')).toBe(true);
  });

  it('is idempotent and keeps a renamed ledger', () => {
    const d = makeBook();
    ensureCoa(d);
    d.coa.find((l: any) => l.id === 'n_sales').name = 'Turnover';
    const again = ensureCoa(d);
    expect(again.find((l) => l.id === 'n_sales')!.name).toBe('Turnover');
    expect(again.filter((l) => l.id === 'n_sales').length).toBe(1);
  });

  it('marks the built-ins so they cannot be removed by mistake', () => {
    const d = makeBook();
    const coa = ensureCoa(d);
    expect(coa.find((l) => l.id === 'n_sales')!.builtin).toBe(true);
  });
});

describe('debitPositive', () => {
  it('treats assets and expenses as rising on a debit', () => {
    expect(debitPositive('asset')).toBe(true);
    expect(debitPositive('expense')).toBe(true);
  });
  it('treats income, liabilities and equity as rising on a credit', () => {
    (['income', 'liability', 'equity'] as LedgerType[]).forEach((t) => {
      expect(debitPositive(t)).toBe(false);
    });
  });
});

describe('ledgerBalance', () => {
  it('reads an asset balance as debits less credits', () => {
    const d = makeBook();
    ensureCoa(d);
    post(d, '2026-01-01', 'In', [{ acc: 'acc_cash', dr: 500 }, { acc: 'n_sales', cr: 500 }]);
    post(d, '2026-01-02', 'Out', [{ acc: 'n_expense', dr: 200 }, { acc: 'acc_cash', cr: 200 }]);
    expect(ledgerBalance(d, 'acc_cash')).toBe(300);
  });

  it('reads an income balance as credits less debits, so it reads positive', () => {
    const d = makeBook();
    ensureCoa(d);
    post(d, '2026-01-01', 'Sale', [{ acc: 'acc_cash', dr: 500 }, { acc: 'n_sales', cr: 500 }]);
    expect(ledgerBalance(d, 'n_sales')).toBe(500);
  });

  it('honours a date window', () => {
    const d = makeBook();
    ensureCoa(d);
    post(d, '2026-01-01', 'Early', [{ acc: 'acc_cash', dr: 100 }, { acc: 'n_sales', cr: 100 }]);
    post(d, '2026-06-01', 'Later', [{ acc: 'acc_cash', dr: 400 }, { acc: 'n_sales', cr: 400 }]);
    const from = new Date('2026-03-01').getTime();
    expect(ledgerBalance(d, 'acc_cash', from)).toBe(400);
  });
});

describe('ledgerHistory', () => {
  it('returns newest first but carries the balance forward oldest first', () => {
    const d = makeBook();
    ensureCoa(d);
    post(d, '2026-01-01', 'One', [{ acc: 'acc_cash', dr: 100 }, { acc: 'n_sales', cr: 100 }]);
    post(d, '2026-01-02', 'Two', [{ acc: 'acc_cash', dr: 50 }, { acc: 'n_sales', cr: 50 }]);
    const h = ledgerHistory(d, 'acc_cash');
    expect(h[0].memo).toBe('Two');
    expect(h[0].balance).toBe(150);
    expect(h[1].balance).toBe(100);
  });

  it('is empty for a ledger nothing has touched', () => {
    const d = makeBook();
    ensureCoa(d);
    expect(ledgerHistory(d, 'n_loyalty')).toEqual([]);
  });
});

describe('trialBalance', () => {
  it('balances when every posting balances', () => {
    const d = makeBook();
    ensureCoa(d);
    post(d, '2026-01-01', 'Sale', [{ acc: 'acc_cash', dr: 500 }, { acc: 'n_sales', cr: 500 }]);
    post(d, '2026-01-02', 'Rent', [{ acc: 'n_expense', dr: 200 }, { acc: 'acc_cash', cr: 200 }]);
    const tb = trialBalance(d);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it('shows the gap when a posting went in unbalanced', () => {
    const d = makeBook();
    ensureCoa(d);
    post(d, '2026-01-01', 'Broken', [{ acc: 'acc_cash', dr: 500 }, { acc: 'n_sales', cr: 400 }]);
    const tb = trialBalance(d);
    expect(Math.abs(tb.totalDebit - tb.totalCredit)).toBe(100);
  });

  it('leaves untouched ledgers out of the listing', () => {
    const d = makeBook();
    ensureCoa(d);
    post(d, '2026-01-01', 'Sale', [{ acc: 'acc_cash', dr: 10 }, { acc: 'n_sales', cr: 10 }]);
    const tb = trialBalance(d);
    expect(tb.rows.every((r) => r.dr || r.cr)).toBe(true);
    expect(tb.rows.some((r) => r.ledger.id === 'n_loyalty')).toBe(false);
  });
});

function book(): any {
  const d = makeBook();
  post(d, '2025-01-01', 'Opening sale', [{ acc: 'acc_cash', dr: 300 }, { acc: 'n_sales', cr: 300 }]);
  post(d, '2025-01-03', 'Bank transfer', [{ acc: 'acc_bank', dr: 200 }, { acc: 'acc_cash', cr: 200 }]);
  post(d, '2025-01-05', 'Rent', [{ acc: 'n_mystery', dr: 50 }, { acc: 'acc_cash', cr: 50 }]);
  ensureCoa(d);
  return d;
}

describe('ledgerBalances — the single-pass version', () => {
  it('gives the same answer as asking one ledger at a time', () => {
    const d = book();
    const map = ledgerBalances(d);
    ((d.coa || []) as any[]).forEach((l: any) => {
      expect(map.get(l.id)).toBe(ledgerBalance(d, l.id));
    });
  });

  it('honours a date window the same way', () => {
    const d = book();
    const from = new Date('2025-01-02').getTime();
    const map = ledgerBalances(d, from);
    ((d.coa || []) as any[]).forEach((l: any) => {
      expect(map.get(l.id)).toBe(ledgerBalance(d, l.id, from));
    });
  });
});
