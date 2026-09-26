/**
 * Upgrading a stored book must never change what it charges.
 *
 * "Prices already include tax" was ignored for as long as it existed: tax was
 * always taken out of the price, and the switch defaulted to off. Honouring it
 * as stored would have added the tax rate to every existing shop's totals.
 */
import { migrate } from '../storage';
import { seed } from '../seed';
import { isPinHashed, verifyPin } from '../pinHash';

function stored(pricesIncludeTax: boolean) {
  const d: any = JSON.parse(JSON.stringify(seed()));
  d.settings.pricesIncludeTax = pricesIncludeTax;
  delete d.settings.taxModeFixed;
  return d;
}

describe('the tax-mode migration', () => {
  it('keeps an old book that said "not included" charging as it always has', () => {
    expect(migrate(stored(false)).settings.pricesIncludeTax).toBe(true);
  });

  it('runs once, so a shop can then genuinely switch to tax on top', () => {
    const d = migrate(stored(false));
    d.settings.pricesIncludeTax = false;
    expect(migrate(d).settings.pricesIncludeTax).toBe(false);
  });

  it('leaves a book that already said "included" alone', () => {
    expect(migrate(stored(true)).settings.pricesIncludeTax).toBe(true);
  });
});

describe('the PIN-hashing migration', () => {
  it('rehashes a PIN a book saved before hashing existed still has in plain text', () => {
    const d = stored(true);
    d.users = [{ id: 'u1', name: 'Owner', role: 'owner', pin: '1234', active: true }];
    const migrated = migrate(d);
    expect(migrated.users[0].pin).not.toBe('1234');
    expect(isPinHashed(migrated.users[0].pin)).toBe(true);
    expect(verifyPin('1234', migrated.users[0].pin)).toBe(true);
  });

  it('leaves an already-hashed PIN alone rather than hashing it again', () => {
    const d = stored(true);
    const already = 'abcd1234abcd1234$deadbeef';
    d.users = [{ id: 'u1', name: 'Owner', role: 'owner', pin: already, active: true }];
    expect(migrate(d).users[0].pin).toBe(already);
  });

  it('leaves "no PIN chosen yet" as the empty string', () => {
    const d = stored(true);
    d.users = [{ id: 'u1', name: 'Owner', role: 'owner', pin: '', active: true }];
    expect(migrate(d).users[0].pin).toBe('');
  });
});
