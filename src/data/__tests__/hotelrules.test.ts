import { seed } from '../seed';
import { hotelActions } from '../actions/hotel';
import { priceStay, stayRules, nightly } from '../hotel';
import type { DB } from '../types';

function setup() {
  const d: DB = seed();
  d.firm.businessType = 'hotel';
  const ref = { current: d };
  const h = hotelActions({ commit: (m: (x: DB) => void) => m(ref.current), requirePerm: () => {}, dbRef: ref as any });
  const t = h.saveRoomType({ name: 'Double', rate: 100000, maxAdults: 2, maxChildren: 1, active: true });
  const r = h.saveRoom({ no: '101', typeId: t.id, active: true });
  return { d, h, t, r };
}

describe('rate rules', () => {
  it('charges weekend nights more and takes a long-stay discount off', () => {
    const { d, h, t, r } = setup();
    h.saveHotelSettings({ weekendPct: 50, longStayNights: 7, longStayPct: 10 } as any);
    // Friday 13 to Friday 20 November 2026: Friday and Saturday nights are the weekend
    const b = { arrive: '2026-11-13', depart: '2026-11-20', ratePlanId: null, rooms: [{ roomId: r.id, typeId: t.id, rate: 100000, adults: 2, children: 0 }] };
    const p = priceStay(d, b as any);
    expect(p.rooms).toBe(5 * 100000 + 2 * 150000);
    expect(p.offer).toBe(80000);
    expect(p.total).toBe(720000);
    expect(p.lines.some((l) => /Long stay/.test(l.desc))).toBe(true);
    // the night audit posts the same nights
    expect(nightly(d, b as any).reduce((a, n) => a + n.amount, 0)).toBe(800000);
  });

  it('says when a stay is too short for its season or arrives on a closed day', () => {
    const { d, h } = setup();
    h.saveSeason({ name: 'Martyrs Day', from: '2026-11-13', to: '2026-11-15', pct: 0, minStay: 3, noArrival: false, active: true } as any);
    h.saveSeason({ name: 'Full house', from: '2026-11-14', to: '2026-11-14', pct: 0, noArrival: true, active: true } as any);
    expect(stayRules(d, '2026-11-14', '2026-11-15')).toEqual([
      'Full house is closed to arrivals on 2026-11-14.',
      'Martyrs Day needs a stay of at least 3 nights (this one is 1).',
    ]);
    expect(stayRules(d, '2026-11-13', '2026-11-16')).toEqual([]);
  });
});
