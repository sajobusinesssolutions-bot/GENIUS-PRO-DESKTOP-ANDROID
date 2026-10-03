/**
 * A book made by the Windows till, opened by this app's own code.
 *
 * The Windows till (GENIUS PRO POS WINDOWS, modules/phonesync) uploads its
 * business as a snapshot in this app's DB shape, so the owner can open it on
 * the phone. This takes such a book and puts it through what the phone does to
 * any book it opens — migrate(), the stock and balance folds, and every report
 * — to prove it is a book the app can actually use, not merely valid JSON.
 *
 * Skipped unless WINDOWS_BOOK names the file. The Windows test writes one:
 *   node test/phonesync.e2e.js /path/book.json      (in the Windows backend)
 *   WINDOWS_BOOK=/path/book.json npx jest windowsBook
 */
import * as fs from 'fs';
import { migrate } from '../storage';
import * as logic from '../logic';
import { REPORTS, runReport } from '../reports';
import { ledgerBalances } from '../coa';

const FILE = process.env.WINDOWS_BOOK;
const maybe = FILE && fs.existsSync(FILE) ? describe : describe.skip;

maybe('a book from the Windows till', () => {
  const raw = FILE ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
  const db = raw ? migrate(JSON.parse(JSON.stringify(raw))) : null;

  it('survives migrate() with its records intact', () => {
    expect(db.firm.id).toBe(raw.firm.id);
    expect(db.products).toHaveLength(raw.products.length);
    expect(db.sales).toHaveLength(raw.sales.length);
    expect(db.settings).toBeTruthy();
    expect(db.roles.length).toBeGreaterThan(0);
  });

  it('holds the stock its movements add up to', () => {
    for (const p of db.products) {
      const moved = db.movements.filter((m: any) => m.productId === p.id).reduce((a: number, m: any) => a + m.qty, 0);
      expect(logic.stockOfImpl(p)).toBeCloseTo(moved, 4);
    }
  });

  it('owes, per customer, what its unpaid bills say', () => {
    for (const party of db.parties.filter((x: any) => x.type === 'customer')) {
      const due = db.sales.filter((s: any) => s.partyId === party.id && s.status !== 'void').reduce((a: number, s: any) => a + s.due, 0);
      expect(logic.partyBalance(db, party.id)).toBeCloseTo(due + (party.openingBalance || 0), 2);
    }
  });

  it('has a ledger whose debits equal its credits', () => {
    const balances: Record<string, number> = ledgerBalances(db) as any;
    const net = Object.values(balances).reduce((a: number, v: any) => a + (Number(v) || 0), 0);
    expect(Math.abs(net)).toBeLessThan(0.01);
  });

  it('runs every report without failing', () => {
    const from = new Date(0), to = new Date(Date.now() + 86400000);
    const broken: string[] = [];
    for (const r of REPORTS) {
      try { runReport(db, r.id, from, to); } catch (e: any) { broken.push(r.id + ': ' + e.message); }
    }
    expect(broken).toEqual([]);
  });
});
