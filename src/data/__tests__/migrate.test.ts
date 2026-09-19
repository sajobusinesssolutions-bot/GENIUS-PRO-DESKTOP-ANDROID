/**
 * Upgrading a stored book must never change what it charges.
 *
 * "Prices already include tax" was ignored for as long as it existed: tax was
 * always taken out of the price, and the switch defaulted to off. Honouring it
 * as stored would have added the tax rate to every existing shop's totals.
 */
import { migrate } from '../storage';
import { seed } from '../seed';

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
