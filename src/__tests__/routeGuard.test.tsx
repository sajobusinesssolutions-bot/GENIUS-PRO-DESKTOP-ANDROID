/**
 * Every screen checks the role, centrally.
 *
 * The bug: about thirty screens checked nothing, so a restricted member of
 * staff reached them by navigating — and the built-in cashier role could edit
 * raised bills. These tests hold the fix in place.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ROUTE_PERMS, permFor, refusalFor } from '../nav/routePerms';
import { builtinRoles, ensureRoles, canWith } from '../data/perms';

const mockDb: any = { session: { role: 'cashier' }, settings: { theme: 'light' } };
jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: mockDb }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

import RouteGuard from '../nav/RouteGuard';

describe('the table of screen permissions', () => {
  it('has a rule for every screen the app registers', () => {
    const nav = fs.readFileSync(path.join(__dirname, '../nav/RootNavigator.tsx'), 'utf8');
    const routes = [...nav.matchAll(/name="([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(80);
    const missing = routes.filter((r) => !(r in ROUTE_PERMS));
    expect(missing).toEqual([]);
  });

  it('only names permissions that exist', () => {
    const all = new Set(Object.keys(builtinRoles()[0].perms));
    const named = Object.keys(ROUTE_PERMS)
      .flatMap((r) => [permFor(r, {}), permFor(r, { partyId: 'x', productId: 'x', close: true })])
      .filter(Boolean) as string[];
    expect(named.filter((k) => !all.has(k))).toEqual([]);
  });

  it('asks more of adding a new item than of opening an existing one', () => {
    expect(permFor('ProductDetail', {})).toBe('inventory.create');
    expect(permFor('ProductDetail', { productId: 'p1' })).toBe('inventory.view');
  });

  it('explains a refusal in words, and says who to ask', () => {
    expect(refusalFor('inventory.stock_adjustment')).toMatch(/cannot adjust stock./);
    expect(refusalFor('sales.view')).toMatch(/cannot see sales/);
    expect(refusalFor('sales.view')).toMatch(/Ask the owner/);
  });
});

describe('RouteGuard', () => {
  afterEach(() => { mockDb.session.role = 'cashier'; });

  it('refuses a cashier the journal', () => {
    render(<RouteGuard route="JournalEntry"><Text>the form</Text></RouteGuard>);
    expect(screen.getByText('Not allowed for your role')).toBeTruthy();
    expect(screen.queryByText('the form')).toBeNull();
  });

  it('refuses a cashier stock adjustment, which used to open for anyone', () => {
    render(<RouteGuard route="StockAdjust"><Text>the form</Text></RouteGuard>);
    expect(screen.queryByText('the form')).toBeNull();
  });

  it('lets a cashier ring up a sale', () => {
    render(<RouteGuard route="NewSale"><Text>the till</Text></RouteGuard>);
    expect(screen.getByText('the till')).toBeTruthy();
  });

  it('lets the owner through everything', () => {
    mockDb.session.role = 'owner';
    render(<RouteGuard route="JournalEntry"><Text>the form</Text></RouteGuard>);
    expect(screen.getByText('the form')).toBeTruthy();
  });

  it('opens a screen with no rule for anyone', () => {
    render(<RouteGuard route="Notifications"><Text>alerts</Text></RouteGuard>);
    expect(screen.getByText('alerts')).toBeTruthy();
  });
});

describe('the built-in roles', () => {
  it('no longer lets a cashier edit or delete a raised bill', () => {
    const cashier = builtinRoles().find((r) => r.id === 'cashier')!;
    expect(cashier.perms['sales.edit']).toBe(false);
    expect(cashier.perms['sales.delete']).toBe(false);
  });

  it('lets a cashier open and close a shift, give a discount and sell', () => {
    const cashier = builtinRoles().find((r) => r.id === 'cashier')!;
    ['sales.create', 'sales.discount', 'shifts.open', 'shifts.close'].forEach((k) => {
      expect(cashier.perms[k]).toBe(true);
    });
  });

  it('takes editing away from an existing cashier role once, on upgrade', () => {
    const old = builtinRoles();
    old.find((r) => r.id === 'cashier')!.perms['sales.edit'] = true;
    const d = { roles: old };
    ensureRoles(d);
    expect(canWith(d.roles, 'cashier', 'sales.edit')).toBe(false);
  });

  it('then respects an owner who deliberately turns it back on', () => {
    const d: any = { roles: builtinRoles() };
    ensureRoles(d);
    d.roles.find((r: any) => r.id === 'cashier').perms['sales.edit'] = true;
    ensureRoles(d);
    expect(canWith(d.roles, 'cashier', 'sales.edit')).toBe(true);
  });

  it('fills a new permission on an existing built-in role with its default, not off', () => {
    const d: any = { roles: builtinRoles() };
    delete d.roles.find((r: any) => r.id === 'cashier').perms['shifts.open'];
    ensureRoles(d);
    expect(canWith(d.roles, 'cashier', 'shifts.open')).toBe(true);
  });

  it('starts a new permission off on a custom role', () => {
    const d: any = { roles: [...builtinRoles(), { id: 'helper', name: 'Helper', description: '', perms: {} }] };
    ensureRoles(d);
    expect(canWith(d.roles, 'helper', 'shifts.open')).toBe(false);
  });
});
