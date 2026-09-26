import { candidateJournalEntries, completeReconciliation, importStatementCsv, importStatementLines, matchStatementLine, parseStatementCsv, summarizeReconciliation } from '../reconciliation';
import { ensureCoa } from '../coa';

function book(): any {
  const d: any = {
    accounts: [{ id: 'acc_bank', name: 'Bank', type: 'bank', opening: 1000 }],
    journal: [], bankStatementLines: [], bankReconciliations: [],
  };
  ensureCoa(d);
  return d;
}

function post(d: any, id: string, lines: any[]) {
  d.journal.push({ id, ts: '2026-09-20T10:00:00.000Z', memo: 'Bank movement', ref: id, lines, balanced: true });
}

describe('bank reconciliation', () => {
  it('parses quoted CSV rows and debit/credit columns', () => {
    const parsed = parseStatementCsv('Date,Description,Debit,Credit,Reference\n2026-09-20,"Bank, fee",20,,FEE-1\n2026-09-20,Deposit,,250,DEP-1');
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { date: '2026-09-20', description: 'Bank, fee', amount: -20, reference: 'FEE-1' },
      { date: '2026-09-20', description: 'Deposit', amount: 250, reference: 'DEP-1' },
    ]);
  });

  it('imports valid CSV rows but reports malformed rows', () => {
    const d = book();
    const result = importStatementCsv(d, 'acc_bank', 'Date,Description,Amount\n2026-09-20,Deposit,250\nbad,Missing date,nope');
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(d.bankStatementLines).toHaveLength(1);
  });

  it('imports statement lines and suggests same-day amount matches', () => {
    const d = book();
    post(d, 'j1', [{ acc: 'acc_bank', dr: 250 }, { acc: 'n_sales', cr: 250 }]);
    const line = importStatementLines(d, 'acc_bank', [{ date: '2026-09-20', description: 'CARD SALE', amount: 250 }])[0];
    expect(candidateJournalEntries(d, line).map((x) => x.id)).toEqual(['j1']);
  });

  it('requires every statement line to be matched before completion', () => {
    const d = book();
    post(d, 'j1', [{ acc: 'acc_bank', dr: 250 }, { acc: 'n_sales', cr: 250 }]);
    const line = importStatementLines(d, 'acc_bank', [{ date: '2026-09-20', description: 'CARD SALE', amount: 250 }])[0];
    expect(matchStatementLine(d, line.id, 'j1')).not.toBeNull();
    expect(summarizeReconciliation(d, 'acc_bank', '2026-09-20', '2026-09-20', 1250).difference).toBe(0);
    expect(completeReconciliation(d, 'acc_bank', '2026-09-20', '2026-09-20', 1250, 'u1')).toMatchObject({ accountId: 'acc_bank' });
  });

  it('does not complete while an imported line is unexplained', () => {
    const d = book();
    importStatementLines(d, 'acc_bank', [{ date: '2026-09-20', description: 'UNKNOWN FEE', amount: -20 }]);
    expect(completeReconciliation(d, 'acc_bank', '2026-09-20', '2026-09-20', 980, 'u1')).toBeNull();
  });
});