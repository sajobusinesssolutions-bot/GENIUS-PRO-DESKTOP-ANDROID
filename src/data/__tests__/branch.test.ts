/**
 * A branch is run as a separate business: its own stock, its own drawer, its
 * own books. These hold that line, because the failure it prevents is quiet —
 * one branch's takings showing up in another's figures reads as a good day
 * rather than as a bug.
 */
import {
  activeBranchId, originalBranchId, inBranch, branchJournal, branchAccounts,
  branchStockValue, branchStockUnits, branchIsEmpty, liveBranches, branchName,
} from '../branch';
import { ledgerBalance, ledgerBalances, trialBalance, ensureCoa } from '../coa';
import * as logic from '../logic';

function book(): any {
  return {
    warehouses: [
      { id: 'w1', name: 'Main shop', active: true },
      { id: 'w2', name: 'Market stall', active: true },
      { id: 'w3', name: 'Old kiosk', active: false },
    ],
    settings: { defaultWarehouse: 'w1', blockNegativeStock: false, allowNegativeStock: true },
    session: { warehouse: 'w1', userId: 'u1', till: 'Till 1' },
    accounts: [
      { id: 'acc_cash', name: 'Drawer', type: 'cash', opening: 0 },
      { id: 'w2_cash', name: 'Stall float', type: 'cash', opening: 0, branch: 'w2' },
    ],
    products: [
      { id: 'p1', name: 'Sugar', cost: 100, price: 150, stock: { w1: 10, w2: 4 } },
      { id: 'p2', name: 'Salt', cost: 50, price: 80, stock: { w1: 2 } },
    ],
    sales: [],
    journal: [],
    movements: [],
    users: [],
    auditLog: [],
  };
}

/** Posts through the real journal() so the stamping path is the one exercised. */
function post(d: any, memo: string, lines: any[]) {
  logic.journal(d, new Date('2026-01-01'), memo, 'T', lines);
}

describe('which branch is being worked in', () => {
  it('follows the session, not the default', () => {
    const d = book();
    d.session.warehouse = 'w2';
    expect(activeBranchId(d)).toBe('w2');
  });

  it('falls back to the default, then to the first branch', () => {
    const d = book();
    d.session.warehouse = '';
    expect(activeBranchId(d)).toBe('w1');
    d.settings.defaultWarehouse = '';
    expect(activeBranchId(d)).toBe('w1');
  });

  it('does not throw on a book that has no session yet', () => {
    expect(activeBranchId({} as any)).toBe('');
    expect(originalBranchId({} as any)).toBe('');
  });

  it('lists only the branches still trading', () => {
    const d = book();
    expect(liveBranches(d).map((w) => w.id)).toEqual(['w1', 'w2']);
  });

  it('names a branch, and says so when there is none', () => {
    const d = book();
    expect(branchName(d, 'w2')).toBe('Market stall');
    expect(branchName(d, undefined)).toBe('All branches');
  });
});

describe('postings are filed against the branch they happened in', () => {
  it('stamps the branch being worked in', () => {
    const d = book();
    d.session.warehouse = 'w2';
    post(d, 'Stall sale', [{ acc: 'acc_cash', dr: 500 }, { acc: 'n_sales', cr: 500 }]);
    expect(d.journal[0].branch).toBe('w2');
  });

  it('keeps each branch\'s takings out of the other\'s', () => {
    const d = book();
    d.session.warehouse = 'w1';
    post(d, 'Shop sale', [{ acc: 'acc_cash', dr: 1000 }, { acc: 'n_sales', cr: 1000 }]);
    d.session.warehouse = 'w2';
    post(d, 'Stall sale', [{ acc: 'acc_cash', dr: 400 }, { acc: 'n_sales', cr: 400 }]);

    expect(branchJournal(d, 'w1').length).toBe(1);
    expect(branchJournal(d, 'w2').length).toBe(1);
    expect(branchJournal(d, null).length).toBe(2);
  });

  it('treats a posting made before branches had books as the first branch\'s', () => {
    const d = book();
    d.journal.push({ id: 'old', ts: '2025-01-01', memo: 'Legacy', ref: 'T', lines: [], balanced: true });
    expect(inBranch(d, undefined, 'w1')).toBe(true);
    expect(inBranch(d, undefined, 'w2')).toBe(false);
    expect(branchJournal(d, 'w1').length).toBe(1);
  });

  it('asking for every branch returns everything, stamped or not', () => {
    const d = book();
    d.journal.push({ id: 'old', ts: '2025-01-01', memo: 'Legacy', ref: 'T', lines: [], balanced: true });
    post(d, 'New', [{ acc: 'acc_cash', dr: 10 }, { acc: 'n_sales', cr: 10 }]);
    expect(branchJournal(d, null).length).toBe(2);
  });
});

describe('the books read one branch at a time', () => {
  function twoBranches() {
    const d = book();
    ensureCoa(d);
    d.session.warehouse = 'w1';
    post(d, 'Shop sale', [{ acc: 'acc_cash', dr: 1000 }, { acc: 'n_sales', cr: 1000 }]);
    d.session.warehouse = 'w2';
    post(d, 'Stall sale', [{ acc: 'acc_cash', dr: 400 }, { acc: 'n_sales', cr: 400 }]);
    return d;
  }

  it('gives each branch its own ledger balance', () => {
    const d = twoBranches();
    expect(ledgerBalance(d, 'acc_cash', 0, Number.MAX_SAFE_INTEGER, 'w1')).toBe(1000);
    expect(ledgerBalance(d, 'acc_cash', 0, Number.MAX_SAFE_INTEGER, 'w2')).toBe(400);
  });

  it('adds up to the firm when every branch is asked for', () => {
    const d = twoBranches();
    expect(ledgerBalance(d, 'acc_cash', 0, Number.MAX_SAFE_INTEGER, null)).toBe(1400);
  });

  it('defaults to the branch being worked in', () => {
    const d = twoBranches();
    d.session.warehouse = 'w2';
    expect(ledgerBalance(d, 'acc_cash')).toBe(400);
    d.session.warehouse = 'w1';
    expect(ledgerBalance(d, 'acc_cash')).toBe(1000);
  });

  it('scopes the single-pass balances the same way', () => {
    const d = twoBranches();
    expect(ledgerBalances(d, 0, Number.MAX_SAFE_INTEGER, 'w2').get('acc_cash')).toBe(400);
    expect(ledgerBalances(d, 0, Number.MAX_SAFE_INTEGER, null).get('acc_cash')).toBe(1400);
  });

  it('gives each branch a trial balance that ties out on its own', () => {
    const d = twoBranches();
    const w2 = trialBalance(d, 0, Number.MAX_SAFE_INTEGER, 'w2');
    expect(w2.totalDebit).toBe(400);
    expect(w2.totalDebit).toBe(w2.totalCredit);

    const all = trialBalance(d, 0, Number.MAX_SAFE_INTEGER, null);
    expect(all.totalDebit).toBe(1400);
    expect(all.totalDebit).toBe(all.totalCredit);
  });
});

describe('accounts belong to a branch', () => {
  it('offers a branch its own accounts and the firm-wide ones', () => {
    const d = book();
    expect(branchAccounts(d, 'w2').map((a: any) => a.id)).toEqual(['acc_cash', 'w2_cash']);
  });

  it('does not offer one branch another branch\'s float', () => {
    const d = book();
    expect(branchAccounts(d, 'w1').map((a: any) => a.id)).toEqual(['acc_cash']);
  });

  it('offers everything when no branch is named', () => {
    const d = book();
    expect(branchAccounts(d, null).length).toBe(2);
  });
});

describe('stock is held per branch', () => {
  it('values only what that branch holds', () => {
    const d = book();
    expect(branchStockValue(d, 'w1')).toBe(10 * 100 + 2 * 50);
    expect(branchStockValue(d, 'w2')).toBe(4 * 100);
    expect(branchStockUnits(d, 'w2')).toBe(4);
  });

  it('counts nothing for a branch that holds nothing', () => {
    const d = book();
    expect(branchStockValue(d, 'w3')).toBe(0);
  });
});

describe('closing a branch', () => {
  it('refuses while stock is still on its shelves', () => {
    const d = book();
    expect(branchIsEmpty(d, 'w2')).toEqual({ empty: false, why: '4 units of stock are still held here' });
  });

  it('refuses while its books hold postings', () => {
    const d = book();
    d.session.warehouse = 'w3';
    post(d, 'Kiosk sale', [{ acc: 'acc_cash', dr: 20 }, { acc: 'n_sales', cr: 20 }]);
    expect(branchIsEmpty(d, 'w3').empty).toBe(false);
    expect(branchIsEmpty(d, 'w3').why).toMatch(/postings/);
  });

  it('refuses while bills were rung up there', () => {
    const d = book();
    d.sales.push({ id: 's1', warehouse: 'w3', status: 'complete' });
    expect(branchIsEmpty(d, 'w3').why).toMatch(/bills/);
  });

  it('allows it once the branch holds nothing at all', () => {
    const d = book();
    expect(branchIsEmpty(d, 'w3')).toEqual({ empty: true, why: '' });
  });
});

describe('opening a branch', () => {
  function firm(): any {
    const d = book();
    ensureCoa(d);
    return d;
  }

  it('creates the branch with its own drawer, not a share of the old one', () => {
    const d = firm();
    const out = logic.openBranch(d, { name: 'Lakeside', openingFloat: 50000 });
    const drawer = d.accounts.find((a: any) => a.id === out.cashAccountId);
    expect(drawer.branch).toBe(out.warehouseId);
    expect(drawer.name).toBe('Cash drawer');
    // the original branch's drawer is untouched
    expect(ledgerBalance(d, 'acc_cash', 0, Number.MAX_SAFE_INTEGER, 'w1')).toBe(0);
  });

  it('posts the opening float into the new branch\'s books', () => {
    const d = firm();
    const out = logic.openBranch(d, { name: 'Lakeside', openingFloat: 50000 });
    expect(ledgerBalance(d, out.cashAccountId, 0, Number.MAX_SAFE_INTEGER, out.warehouseId)).toBe(50000);
    const entry = d.journal.find((e: any) => e.ref === 'BRANCH');
    expect(entry.branch).toBe(out.warehouseId);
    expect(entry.balanced).toBe(true);
  });

  it('moves stock in as a transfer, so the firm holds no more than before', () => {
    const d = firm();
    const before = branchStockUnits(d, 'w1') + branchStockUnits(d, 'w2');
    const out = logic.openBranch(d, {
      name: 'Lakeside', stockFrom: 'w1', stockLines: [{ productId: 'p1', qty: 4 }],
    });
    expect(branchStockUnits(d, out.warehouseId)).toBe(4);
    expect(branchStockUnits(d, 'w1')).toBe(10 - 4 + 2); // sugar less four, salt untouched
    const after = branchStockUnits(d, 'w1') + branchStockUnits(d, 'w2') + branchStockUnits(d, out.warehouseId);
    expect(after).toBe(before);
  });

  it('moves what is there and says what was short, rather than inventing stock', () => {
    const d = firm();
    const out = logic.openBranch(d, {
      name: 'Lakeside', stockFrom: 'w1', stockLines: [{ productId: 'p2', qty: 9 }],
    });
    expect(branchStockUnits(d, out.warehouseId)).toBe(2);
    expect(out.shortfalls).toEqual([{ productId: 'p2', name: 'Salt', wanted: 9, had: 2 }]);
  });

  it('gives the branch its own document prefix', () => {
    const d = firm();
    const out = logic.openBranch(d, { name: 'Lakeside', prefix: 'lake' });
    expect(d.warehouses.find((w: any) => w.id === out.warehouseId).prefix).toBe('LAKE');
  });

  it('starts work in the new branch unless told not to', () => {
    const d = firm();
    const out = logic.openBranch(d, { name: 'Lakeside' });
    expect(d.session.warehouse).toBe(out.warehouseId);

    const d2 = firm();
    logic.openBranch(d2, { name: 'Far away', makeActive: false });
    expect(d2.session.warehouse).toBe('w1');
  });

  it('refuses a branch with no name, or one that already exists', () => {
    const d = firm();
    expect(() => logic.openBranch(d, { name: '  ' })).toThrow(/needs a name/);
    expect(() => logic.openBranch(d, { name: 'market stall' })).toThrow(/already a branch/);
  });

  it('records the opening in the audit trail', () => {
    const d = firm();
    logic.openBranch(d, { name: 'Lakeside', openingFloat: 1000 });
    expect(d.auditLog[0].action).toBe('Branch opened');
    expect(d.auditLog[0].details).toMatch(/Lakeside/);
  });

  it('adds a second account only when one was asked for', () => {
    const d = firm();
    const before = d.accounts.length;
    logic.openBranch(d, { name: 'A' });
    expect(d.accounts.length).toBe(before + 1);
    logic.openBranch(d, { name: 'B', extraAccount: { name: 'B MoMo', type: 'wallet' } });
    expect(d.accounts.length).toBe(before + 3);
    expect(d.accounts[d.accounts.length - 1].type).toBe('wallet');
  });
});
