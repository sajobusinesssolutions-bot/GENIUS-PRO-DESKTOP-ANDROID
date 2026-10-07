import { ensureRoles, canWith, roleName, allPermKeys } from '../perms';
import { permFor } from '../../nav/routePerms';

describe('a role with only the kitchen display', () => {
  const perms: Record<string, boolean> = {};
  allPermKeys().forEach((k) => { perms[k] = false; });
  perms['restaurant.kitchen'] = true;
  const d: any = { firm: { businessType: 'restaurant' }, roles: [{ id: 'r_kds1', name: 'Kitchen', description: '', perms, builtin: false }] };
  const roles = ensureRoles(d);

  it('opens the kitchen display and nothing at the till', () => {
    expect(canWith(roles, 'r_kds1', permFor('KitchenTab'))).toBe(true);
    expect(canWith(roles, 'r_kds1', permFor('OrderTab'))).toBe(false);
    expect(canWith(roles, 'r_kds1', permFor('SalesTab'))).toBe(false);
    expect(canWith(roles, 'r_kds1', 'restaurant.charge')).toBe(false);
  });

  it('is shown by its name, not its id', () => {
    expect(roleName(d, 'r_kds1')).toBe('Kitchen');
  });
});
