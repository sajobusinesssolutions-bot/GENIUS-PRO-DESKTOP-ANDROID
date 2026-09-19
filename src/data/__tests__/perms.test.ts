import {
  PERM_MATRIX, allPermKeys, builtinRoles, ensureRoles, permCount, canWith,
  LEGACY_PERM, canFor, setRoleRegistry, ownersLeftWithout, usersOnRole,
} from '../perms';
import type { RoleDef } from '../types';

const byId = (rs: RoleDef[], id: string) => rs.find((r) => r.id === id)!;

describe('the permission matrix', () => {
  it('is per-action, not one switch per module', () => {
    const exports_ = PERM_MATRIX.find((g) => g.k === 'exports')!;
    expect(exports_.n).toBe('Exports (PDF & CSV)');
    expect(exports_.acts).toEqual([['download', 'Download']]);
    const inv = PERM_MATRIX.find((g) => g.k === 'inventory')!;
    expect(inv.acts.map((a) => a[0])).toContain('view_cost_price');
    expect(inv.acts.map((a) => a[0])).toContain('view_profit');
  });

  it('names every key group.action, with no duplicates', () => {
    const keys = allPermKeys();
    expect(keys.length).toBe(new Set(keys).size);
    keys.forEach((k) => expect(k).toMatch(/^[a-z_]+\.[a-z_]+$/));
    expect(keys).toContain('dashboard.view_gross_profit');
  });
});

describe('the built-in roles', () => {
  it('gives the owner everything', () => {
    const owner = byId(builtinRoles(), 'owner');
    expect(permCount(owner)).toBe(allPermKeys().length);
  });

  it('withholds staff and settings management from the manager', () => {
    const rs = builtinRoles();
    const mgr = byId(rs, 'manager');
    expect(mgr.perms['profiles.manage']).toBe(false);
    expect(mgr.perms['settings.manage']).toBe(false);
    expect(mgr.perms['inventory.view_cost_price']).toBe(true);
    expect(permCount(mgr)).toBe(allPermKeys().length - 2);
  });

  it('keeps cost prices and money away from the cashier', () => {
    const csh = byId(builtinRoles(), 'cashier');
    expect(csh.perms['sales.create']).toBe(true);
    expect(csh.perms['inventory.view_selling_price']).toBe(true);
    expect(csh.perms['inventory.view_cost_price']).toBe(false);
    expect(csh.perms['inventory.view_profit']).toBe(false);
    expect(csh.perms['finance.view']).toBe(false);
  });
});

describe('canWith', () => {
  const rs = builtinRoles();

  it('answers a fine-grained key straight from the matrix', () => {
    expect(canWith(rs, 'manager', 'inventory.view_cost_price')).toBe(true);
    expect(canWith(rs, 'cashier', 'inventory.view_cost_price')).toBe(false);
  });

  it('maps a coarse legacy key onto its fine one', () => {
    expect(LEGACY_PERM.sell).toBe('sales.create');
    expect(canWith(rs, 'cashier', 'sell')).toBe(true);
    expect(canWith(rs, 'cashier', 'money')).toBe(false);
    expect(canWith(rs, 'manager', 'settings')).toBe(false);
    expect(canWith(rs, 'owner', 'settings')).toBe(true);
  });

  it('falls back to a module view right for an unknown key', () => {
    expect(canWith(rs, 'cashier', 'inventory.something_new')).toBe(true);
    expect(canWith(rs, 'cashier', 'finance.something_new')).toBe(false);
  });

  it('lets the owner through whatever the record says', () => {
    const tampered = builtinRoles();
    byId(tampered, 'owner').perms['sales.view'] = false;
    expect(canWith(tampered, 'owner', 'sales.view')).toBe(true);
  });

  it('treats a null key as no gate at all', () => {
    expect(canWith(rs, 'cashier', null)).toBe(true);
  });
});

describe('ensureRoles', () => {
  it('fills in a key added after the book was written', () => {
    const rs = builtinRoles();
    delete byId(rs, 'cashier').perms['sales.refund'];
    ensureRoles({ roles: rs });
    expect(byId(rs, 'cashier').perms['sales.refund']).toBe(false);
  });

  it('puts the owner back to everything', () => {
    const rs = builtinRoles();
    byId(rs, 'owner').perms['settings.manage'] = false;
    ensureRoles({ roles: rs });
    expect(permCount(byId(rs, 'owner'))).toBe(allPermKeys().length);
  });

  it('upgrades an old coarse on/off map into the matrix', () => {
    const d: any = { roles: { cashier: { sell: false, items: false }, manager: {} } };
    const rs = ensureRoles(d);
    expect(Array.isArray(rs)).toBe(true);
    expect(byId(rs, 'cashier').perms['sales.create']).toBe(false);
    expect(byId(rs, 'cashier').perms['inventory.view']).toBe(false);
    expect(byId(rs, 'manager').perms['sales.create']).toBe(true);
  });

  it('builds the built-ins when there is nothing to upgrade', () => {
    const d: any = {};
    expect(ensureRoles(d).map((r) => r.id)).toEqual(['owner', 'manager', 'cashier']);
  });
});

describe('a custom role', () => {
  it('is gated by exactly the boxes that were ticked', () => {
    const perms: Record<string, boolean> = {};
    allPermKeys().forEach((k) => { perms[k] = false; });
    perms['sales.view'] = true;
    perms['exports.download'] = true;
    const rs = builtinRoles().concat([
      { id: 'role_clerk', name: 'Clerk', description: '', perms, builtin: false },
    ]);
    expect(canWith(rs, 'role_clerk', 'sales.view')).toBe(true);
    expect(canWith(rs, 'role_clerk', 'exports.download')).toBe(true);
    expect(canWith(rs, 'role_clerk', 'sales.create')).toBe(false);
    expect(canWith(rs, 'role_clerk', 'settings')).toBe(false);
    expect(permCount(rs[3])).toBe(2);
  });
});

describe('canFor reads the live registry', () => {
  afterEach(() => setRoleRegistry(builtinRoles()));

  it('follows an edit made to a role', () => {
    expect(canFor('cashier', 'inventory.view_cost_price')).toBe(false);
    const edited = builtinRoles();
    byId(edited, 'cashier').perms['inventory.view_cost_price'] = true;
    setRoleRegistry(edited);
    expect(canFor('cashier', 'inventory.view_cost_price')).toBe(true);
  });

  it('keeps the old registry when handed nothing', () => {
    setRoleRegistry(undefined);
    expect(canFor('owner', 'settings')).toBe(true);
  });
});

describe('not locking yourself out', () => {
  const rs = builtinRoles();
  const users = [
    { id: 'u1', name: 'Ann', role: 'owner', active: true },
    { id: 'u2', name: 'Ben', role: 'cashier', active: true },
  ];

  it('counts the people who can manage staff and settings', () => {
    expect(ownersLeftWithout(users, rs, { userId: 'u2', active: false })).toBe(1);
  });

  it('sees that demoting the only owner would leave nobody', () => {
    expect(ownersLeftWithout(users, rs, { userId: 'u1', role: 'cashier' })).toBe(0);
    expect(ownersLeftWithout(users, rs, { userId: 'u1', active: false })).toBe(0);
  });

  it('is happy once a second owner exists', () => {
    const two = users.concat([{ id: 'u3', name: 'Cal', role: 'owner', active: true }]);
    expect(ownersLeftWithout(two, rs, { userId: 'u1', active: false })).toBe(1);
  });

  it('counts only the active people on a role', () => {
    expect(usersOnRole(users, 'owner')).toBe(1);
    expect(usersOnRole(users.concat([{ id: 'u4', name: 'Dee', role: 'owner', active: false }]), 'owner')).toBe(1);
  });
});
