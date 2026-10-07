import { demoBook, DEMO_PIN } from '../demos';
import { verifyPin } from '../pinHash';
import { menuSections } from '../restaurant';

describe('demo businesses', () => {
  it('opens a working restaurant: menu, open tables, kitchen display, owner PIN 0000', () => {
    const d = demoBook('restaurant');
    expect(d.demo).toBe(true);
    expect(d.onboarded).toBe(true);
    expect(d.firm.businessType).toBe('restaurant');
    expect(menuSections(d).map((s) => s.name)).toEqual(['Starters', 'Mains', 'Drinks', 'Desserts']);
    expect((d.tickets || []).filter((t) => t.status === 'open').length).toBe(2);
    expect(d.products.some((p) => p.ingredient)).toBe(true);
    expect(verifyPin(DEMO_PIN, d.users.find((u) => u.role === 'owner')!.pin)).toBe(true);
    expect(d.roles.find((r) => r.id === 'sales')!.name).toBe('Waiter (sales)');
  });
  it('opens a pharmacy with batches, one about to expire and one expired, and Rx drugs', () => {
    const d = demoBook('pharmacy');
    const lots = d.products.flatMap((p) => p.batches || []);
    expect(lots.some((b) => new Date(b.expiry!).getTime() < Date.now())).toBe(true);
    expect(d.products.some((p) => p.rxOnly)).toBe(true);
    expect(d.settings.trackBatches).toBe(true);
  });
  it('opens the retail sample shop as a demo', () => {
    const d = demoBook('retail');
    expect(d.demo).toBe(true);
    expect(d.products.length).toBeGreaterThan(5);
  });
});
