/**
 * A shop that has just signed up gets empty books.
 *
 * The app ships with a demo — twelve products, a few customers, about five
 * million shillings of opening balances belonging to "Sample Traders". Useful
 * for looking around, and wrong for somebody who has just created an account:
 * they would have to hunt down and delete a stranger's stock and money before
 * a single figure the app showed them could be trusted.
 *
 * These tests are the ones that would have caught it being shipped.
 */
import { seed, emptyBook } from '../seed';
import { trialBalance, ledgerBalance } from '../coa';

describe('the demo the app ships with', () => {
  it('really does contain a demo shop, which is why emptyBook exists', () => {
    const d = seed();
    expect(d.products.length).toBeGreaterThan(0);
    expect(d.parties.length).toBeGreaterThan(0);
    expect(d.accounts.some((a) => a.opening > 0)).toBe(true);
  });
});

describe('emptyBook', () => {
  it('has no stock and nobody on file', () => {
    const d = emptyBook();
    expect(d.products).toEqual([]);
    expect(d.parties).toEqual([]);
  });

  it('has no trading history of any kind', () => {
    const d = emptyBook();
    expect(d.sales).toEqual([]);
    expect(d.purchases).toEqual([]);
    expect(d.payments).toEqual([]);
    expect(d.entries).toEqual([]);
    expect(d.movements).toEqual([]);
    expect(d.journal).toEqual([]);
    expect(d.shifts).toEqual([]);
    expect(d.estimates).toEqual([]);
    expect(d.creditNotes).toEqual([]);
    expect(d.auditLog).toEqual([]);
  });

  it('starts every account at nothing, not at somebody else\'s float', () => {
    const d = emptyBook();
    expect(d.accounts.every((a) => a.opening === 0)).toBe(true);
    expect(ledgerBalance(d, 'acc_cash', 0, Number.MAX_SAFE_INTEGER, null)).toBe(0);
  });

  it('opens with a trial balance of zero on both sides', () => {
    const tb = trialBalance(emptyBook(), 0, Number.MAX_SAFE_INTEGER, null);
    expect(tb.totalDebit).toBe(0);
    expect(tb.totalCredit).toBe(0);
  });

  it('keeps the accounts themselves — a shop needs somewhere to put money', () => {
    const d = emptyBook();
    expect(d.accounts.length).toBeGreaterThan(0);
    expect(d.accounts.some((a) => a.type === 'cash')).toBe(true);
  });

  it('keeps the chart of accounts, so the books can be posted to', () => {
    const d = emptyBook();
    expect((d.coa || []).length).toBeGreaterThan(0);
    expect((d.coa || []).some((l) => l.id === 'n_sales')).toBe(true);
  });

  it('carries no trace of the demo business', () => {
    const d = emptyBook();
    expect(d.firm.name).not.toBe('Sample Traders');
    expect(d.firm.tin).toBe('');
    expect(d.firm.address).toBe('');
    expect(d.firms.length).toBe(1);
  });

  it('takes the names it was given', () => {
    const d = emptyBook({ firmName: 'Lakeside Stores', ownerName: 'Ada Nakato', branchName: 'Town branch' });
    expect(d.firm.name).toBe('Lakeside Stores');
    expect(d.users[0].name).toBe('Ada Nakato');
    expect(d.warehouses[0].name).toBe('Town branch');
  });

  it('has one branch, not the demo\'s two', () => {
    expect(emptyBook().warehouses.length).toBe(1);
    expect(seed().warehouses.length).toBeGreaterThan(1);
  });

  it('has one user, who is the owner', () => {
    const d = emptyBook();
    expect(d.users.length).toBe(1);
    expect(d.users[0].role).toBe('owner');
    expect(d.session.role).toBe('owner');
  });

  it('is not onboarded, because setting the business up is what comes next', () => {
    expect(emptyBook().onboarded).toBe(false);
    // the demo is, which is why a fresh signup skipped straight past setup
    expect(seed().onboarded).toBe(true);
  });

  it('starts every document number from the beginning', () => {
    const c = emptyBook().counters;
    expect(Object.values(c).every((n) => n === 0)).toBe(true);
  });

  it('records which account the books belong to', () => {
    expect(emptyBook({ ownerEmail: '  Owner@Example.COM ' }).ownerEmail).toBe('owner@example.com');
    expect(emptyBook().ownerEmail).toBeUndefined();
  });

  it('points the session at the branch it made', () => {
    const d = emptyBook();
    expect(d.session.warehouse).toBe(d.warehouses[0].id);
    expect(d.settings.defaultWarehouse).toBe(d.warehouses[0].id);
  });
});

describe('no invented person appears in a real shop', () => {
  it('does not inherit the demo staff', () => {
    const demoNames = seed().users.map((u) => u.name);
    const d = emptyBook();
    expect(demoNames).toContain('Ronald Okello');
    expect(demoNames).not.toContain(d.users[0].name);
  });

  it('calls the owner what they said they were called', () => {
    expect(emptyBook({ ownerName: 'Amar' }).users[0].name).toBe('Amar');
  });

  it('falls back to a job title, never to a name somebody made up', () => {
    expect(emptyBook().users[0].name).toBe('Owner');
  });

  it('gives the shop a neutral name until one is chosen', () => {
    expect(emptyBook().firm.name).toBe('My shop');
  });
});

describe('accounts on a fresh book', () => {
  it('carry plain names, not the demo\'s — one of which was a real bank', () => {
    const names = emptyBook().accounts.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(['Cash drawer', 'Bank account', 'Mobile money']));
    expect(names.join(' ')).not.toMatch(/Stanbic|MTN|Till 1/);
  });
});
