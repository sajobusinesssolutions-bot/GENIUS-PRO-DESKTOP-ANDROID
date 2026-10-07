/**
 * RESTAURANT AND PHARMACY REPORTS.
 *
 * Moved out of reports.ts, which had grown past three thousand lines. They are
 * built exactly as before; reports.ts hands over the helpers they share
 * (salesBetween, m, sumCol…) when it registers them, so this module never
 * imports reports.ts at run time.
 */
import type { DB, Sale, SaleLine } from './types';
import type { Cell, CellObj, ReportResult, RowRef } from './reports';
import { stationOf } from './restaurant';

/** Set when the reports are registered; the module-level helpers below read it. */
let H: ReportHelpers;

type Builder = (db: DB, from: number, to: number, money: (n: number) => string) => ReportResult;

/** What reports.ts lends these builders. */
export interface ReportHelpers {
  salesBetween: (db: DB, from: number, to: number) => Sale[];
  m: (n: number) => CellObj;
  sumCol: (rows: Cell[][], i: number) => number;
  within: (ts: string, from: number, to: number) => boolean;
  shortDay: (ts: string | number) => string;
  partyName: (db: DB, id: string | null | undefined) => string;
  pad2: (n: number | string) => string;
  money0: (n: number) => string;
}



/** Revenue by menu (or by section when no menus are set up), largest first. */
export function byMenuOf(db: DB, sales: Sale[]): [string, { qty: number; amount: number }][] {
  const menus = db.menus || [];
  const out = new Map<string, { qty: number; amount: number }>();
  sales.forEach((s) => s.lines.forEach((l) => {
    const cat = db.products.find((p) => p.id === l.productId)?.category || 'Other';
    const k = menus.length ? (menus.find((mn) => mn.sections.includes(cat))?.name || 'Not on a menu') : cat;
    const v = out.get(k) || { qty: 0, amount: 0 };
    v.qty += l.qty; v.amount += l.qty * l.price;
    out.set(k, v);
  }));
  return [...out.entries()].sort((a, b) => b[1].amount - a[1].amount);
}

const share = (part: number, all: number): CellObj => ({ text: all ? (part / all * 100).toFixed(1) + '%' : '—', n: all ? part / all * 100 : 0 });

/** Plates and revenue by a key read off each line. */
function lineRollup(db: DB, from: number, to: number, keyOf: (l: SaleLine, s: Sale) => string) {
  const out = new Map<string, { qty: number; amount: number; orders: Set<string> }>();
  H.salesBetween(db, from, to).forEach((s) => s.lines.forEach((l) => {
    const k = keyOf(l, s);
    const v = out.get(k) || { qty: 0, amount: 0, orders: new Set<string>() };
    v.qty += l.qty; v.amount += l.qty * l.price; v.orders.add(s.id);
    out.set(k, v);
  }));
  return [...out.entries()].sort((a, b) => b[1].amount - a[1].amount);
}

/** The restaurant reports, and the pharmacy's prescription register. */
export function restaurantReports(h: ReportHelpers): Record<string, Builder> {
  H = h;
  const { salesBetween, m, sumCol, within, shortDay, partyName, pad2 } = h;
  void pad2;
  const RPT: Record<string, Builder> = {};

RPT['rest-menu-mix'] = (db, from, to, money) => {
  const list = lineRollup(db, from, to, (l) => l.productId);
  const all = list.reduce((n, [, v]) => n + v.amount, 0);
  const plates = list.reduce((n, [, v]) => n + v.qty, 0);
  const avgQty = list.length ? plates / list.length : 0;
  const rows: Cell[][] = list.map(([id, v], i) => {
    const p = db.products.find((x) => x.id === id);
    // menu engineering, by popularity alone: a dish selling well above the average is a star
    const tag = v.qty >= avgQty * 1.2 ? { text: 'Star', tone: 'good' as const } : v.qty <= avgQty * 0.5 ? { text: 'Slow', tone: 'danger' as const } : { text: 'Steady', tone: 'muted' as const };
    return [String(i + 1), p?.name || 'Removed dish', p?.category || '—', v.qty, m(v.amount), share(v.amount, all), tag];
  });
  return {
    title: 'Menu mix',
    stats: [
      { k: 'Plates sold', v: String(plates), tone: 'a' },
      { k: 'Revenue', v: money(all), tone: 'g' },
      { k: 'Best seller', v: rows[0] ? String(rows[0][1]) : '—' },
    ],
    cols: [{ h: '#' }, { h: 'Dish' }, { h: 'Section' }, { h: 'Plates', r: true }, { h: 'Revenue', r: true }, { h: 'Share', r: true }, { h: 'Popularity' }],
    rows,
    foot: ['', 'Total', '', plates, m(all), '100%', ''],
    rowRefs: list.map(([id]) => ({ kind: 'product' as const, id })),
    searchable: true,
    note: 'Star: sells at least 20% above the average dish. Slow: half the average or less — a candidate to change or drop.',
  };
};

RPT['rest-sections'] = (db, from, to) => {
  const list = lineRollup(db, from, to, (l) => db.products.find((p) => p.id === l.productId)?.category || 'Other');
  const all = list.reduce((n, [, v]) => n + v.amount, 0);
  const rows: Cell[][] = list.map(([k, v]) => [k, v.orders.size, v.qty, m(v.amount), share(v.amount, all)]);
  return {
    title: 'Sales by section',
    cols: [{ h: 'Section' }, { h: 'Orders', r: true }, { h: 'Plates', r: true }, { h: 'Revenue', r: true }, { h: 'Share', r: true }],
    rows,
    foot: ['Total', '', sumCol(rows, 2), m(all), '100%'],
  };
};

RPT['rest-menus'] = (db, from, to) => {
  const list = byMenuOf(db, salesBetween(db, from, to));
  const all = list.reduce((n, [, v]) => n + v.amount, 0);
  const rows: Cell[][] = list.map(([k, v]) => [k, v.qty, m(v.amount), share(v.amount, all)]);
  return {
    title: 'Sales by menu',
    cols: [{ h: (db.menus || []).length ? 'Menu' : 'Section' }, { h: 'Plates', r: true }, { h: 'Revenue', r: true }, { h: 'Share', r: true }],
    rows,
    foot: ['Total', sumCol(rows, 1), m(all), '100%'],
    note: (db.menus || []).length ? undefined : 'No menus are set up yet, so this shows sections. Make menus in Menu & modifiers.',
  };
};

RPT['rest-order-types'] = (db, from, to, money) => {
  const words: Record<string, string> = { dine: 'Dine in', takeaway: 'Takeaway', delivery: 'Delivery' };
  const out = new Map<string, { n: number; v: number; service: number }>();
  salesBetween(db, from, to).forEach((s) => {
    const k = words[s.orderType || ''] || 'Not recorded';
    const x = out.get(k) || { n: 0, v: 0, service: 0 };
    x.n++; x.v += s.total; x.service += s.additionalCharges || 0;
    out.set(k, x);
  });
  const list = [...out.entries()].sort((a, b) => b[1].v - a[1].v);
  const all = list.reduce((n, [, x]) => n + x.v, 0);
  const rows: Cell[][] = list.map(([k, x]) => [k, x.n, m(x.v), m(x.n ? x.v / x.n : 0), m(x.service), share(x.v, all)]);
  return {
    title: 'Dine in, takeaway & delivery',
    stats: [{ k: 'Orders', v: String(sumCol(rows, 1)), tone: 'a' }, { k: 'Revenue', v: money(all), tone: 'g' }],
    cols: [{ h: 'Type' }, { h: 'Orders', r: true }, { h: 'Revenue', r: true }, { h: 'Average bill', r: true }, { h: 'Service charge', r: true }, { h: 'Share', r: true }],
    rows,
    foot: ['Total', sumCol(rows, 1), m(all), m(sumCol(rows, 1) ? all / sumCol(rows, 1) : 0), m(sumCol(rows, 4)), '100%'],
  };
};

RPT['rest-hours'] = (db, from, to) => {
  const b = Array.from({ length: 24 }, () => ({ n: 0, v: 0, plates: 0 }));
  salesBetween(db, from, to).forEach((s) => {
    const h = new Date(s.ts).getHours();
    b[h].n++; b[h].v += s.total; b[h].plates += s.lines.reduce((n, l) => n + l.qty, 0);
  });
  const peak = Math.max(1, ...b.map((x) => x.n));
  const rows: Cell[][] = [];
  b.forEach((x, i) => {
    if (!x.n) return;
    rows.push([pad2(i) + ':00', x.n, x.plates, m(x.v), m(x.v / x.n), { text: '█'.repeat(Math.max(1, Math.round(x.n / peak * 10))), tone: x.n === peak ? 'good' : 'muted' }]);
  });
  const best = b.reduce((n, x, i) => (x.n > b[n].n ? i : n), 0);
  return {
    title: 'Busy hours',
    stats: rows.length ? [{ k: 'Busiest hour', v: pad2(best) + ':00', tone: 'a' }] : undefined,
    cols: [{ h: 'Hour' }, { h: 'Orders', r: true }, { h: 'Plates', r: true }, { h: 'Revenue', r: true }, { h: 'Average bill', r: true }, { h: 'Busy' }],
    rows,
    foot: ['Total', sumCol(rows, 1), sumCol(rows, 2), m(sumCol(rows, 3)), '', ''],
  };
};

RPT['rest-day-week'] = (db, from, to) => {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const b = names.map(() => ({ n: 0, v: 0, days: new Set<string>() }));
  salesBetween(db, from, to).forEach((s) => {
    const d = new Date(s.ts);
    b[d.getDay()].n++; b[d.getDay()].v += s.total; b[d.getDay()].days.add(d.toDateString());
  });
  const order = [1, 2, 3, 4, 5, 6, 0];
  const rows: Cell[][] = order.filter((i) => b[i].n).map((i) => [names[i], b[i].n, m(b[i].v), m(b[i].days.size ? b[i].v / b[i].days.size : 0)]);
  return {
    title: 'Day of the week',
    cols: [{ h: 'Day' }, { h: 'Orders', r: true }, { h: 'Revenue', r: true }, { h: 'Average per day', r: true }],
    rows,
    foot: ['Total', sumCol(rows, 1), m(sumCol(rows, 2)), ''],
  };
};

RPT['rest-servers'] = (db, from, to) => {
  const out = new Map<string, { n: number; v: number; plates: number; service: number }>();
  salesBetween(db, from, to).forEach((s) => {
    const x = out.get(s.userId) || { n: 0, v: 0, plates: 0, service: 0 };
    x.n++; x.v += s.total; x.plates += s.lines.reduce((n, l) => n + l.qty, 0); x.service += s.additionalCharges || 0;
    out.set(s.userId, x);
  });
  const list = [...out.entries()].sort((a, b) => b[1].v - a[1].v);
  const rows: Cell[][] = list.map(([id, x]) => [db.users.find((u) => u.id === id)?.name || 'Staff', x.n, x.plates, m(x.v), m(x.n ? x.v / x.n : 0), m(x.service)]);
  return {
    title: 'Sales by waiter',
    cols: [{ h: 'Waiter' }, { h: 'Orders', r: true }, { h: 'Plates', r: true }, { h: 'Revenue', r: true }, { h: 'Average bill', r: true }, { h: 'Service charge', r: true }],
    rows,
    foot: ['Total', sumCol(rows, 1), sumCol(rows, 2), m(sumCol(rows, 3)), '', m(sumCol(rows, 5))],
  };
};

RPT['rest-tables'] = (db, from, to) => {
  const out = new Map<string, { n: number; v: number }>();
  salesBetween(db, from, to).forEach((s) => {
    const k = s.ticketName || 'No table / name';
    const x = out.get(k) || { n: 0, v: 0 };
    x.n++; x.v += s.total;
    out.set(k, x);
  });
  const rows: Cell[][] = [...out.entries()].sort((a, b) => b[1].v - a[1].v).map(([k, x]) => [k, x.n, m(x.v), m(x.v / x.n)]);
  return {
    title: 'Sales by table',
    cols: [{ h: 'Table or name' }, { h: 'Orders', r: true }, { h: 'Revenue', r: true }, { h: 'Average bill', r: true }],
    rows,
    foot: ['Total', sumCol(rows, 1), m(sumCol(rows, 2)), ''],
    searchable: true,
  };
};

RPT['rest-modifiers'] = (db, from, to) => {
  const out = new Map<string, { n: number; v: number; group: string }>();
  let orders = 0;
  salesBetween(db, from, to).forEach((s) => {
    orders++;
    s.lines.forEach((l) => (l.modifiers || []).forEach((mo) => {
      const k = mo.group + ' · ' + mo.name;
      const x = out.get(k) || { n: 0, v: 0, group: mo.group };
      x.n += l.qty; x.v += mo.price * l.qty;
      out.set(k, x);
    }));
  });
  const rows: Cell[][] = [...out.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, x]) => [x.group, k.split(' · ').slice(1).join(' · '), x.n, m(x.v)]);
  return {
    title: 'Modifier sales',
    cols: [{ h: 'Group' }, { h: 'Choice' }, { h: 'Times', r: true }, { h: 'Revenue added', r: true }],
    rows,
    foot: ['Total', '', sumCol(rows, 2), m(sumCol(rows, 3))],
    note: rows.length ? 'Choices taken on ' + orders + ' orders in the period.' : 'No modifiers were ordered in this period.',
  };
};

RPT['rest-stations'] = (db, from, to) => {
  const list = lineRollup(db, from, to, (l) => stationOf(db, db.products.find((p) => p.id === l.productId)));
  const all = list.reduce((n, [, v]) => n + v.amount, 0);
  const rows: Cell[][] = list.map(([k, v]) => [k, v.orders.size, v.qty, m(v.amount), share(v.amount, all)]);
  return {
    title: 'Sales by station',
    cols: [{ h: 'Station' }, { h: 'Orders', r: true }, { h: 'Plates', r: true }, { h: 'Revenue', r: true }, { h: 'Share', r: true }],
    rows,
    foot: ['Total', '', sumCol(rows, 2), m(all), '100%'],
  };
};

RPT['rest-cancelled'] = (db, from, to, money) => {
  const list = (db.tickets || []).filter((x) => x.status === 'void' && within(x.updatedAt, from, to))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const rows: Cell[][] = list.map((x) => {
    const v = x.lines.reduce((n, l) => n + l.qty * l.price, 0);
    const sent = x.lines.reduce((n, l, i) => n + Math.min(l.qty, x.sent[i] || 0), 0);
    return [shortDay(x.updatedAt), x.no + ' · ' + x.name, db.users.find((u) => u.id === x.userId)?.name || '—',
      sent ? { text: sent + ' cooked', tone: 'danger' } : { text: 'none', tone: 'muted' }, m(v)];
  });
  const all = sumCol(rows, 4);
  return {
    title: 'Cancelled tickets',
    stats: [{ k: 'Cancelled', v: String(rows.length), tone: 'w' }, { k: 'Value', v: money(all), tone: 'd' }],
    cols: [{ h: 'Date' }, { h: 'Ticket' }, { h: 'Waiter' }, { h: 'Sent to kitchen' }, { h: 'Value', r: true }],
    rows,
    foot: ['Total', '', '', '', m(all)],
    note: 'Food already sent to the kitchen and then cancelled is waste worth checking.',
  };
};

RPT['rest-sold-out'] = (db, from, to) => {
  const sold = new Map<string, number>();
  salesBetween(db, from, to).forEach((s) => s.lines.forEach((l) => sold.set(l.productId, (sold.get(l.productId) || 0) + l.qty)));
  const dishes = db.products.filter((p) => p.active !== false);
  const rows: Cell[][] = dishes
    .filter((p) => p.soldOut || !sold.get(p.id))
    .sort((a, b) => Number(!!b.soldOut) - Number(!!a.soldOut) || a.name.localeCompare(b.name))
    .map((p) => [p.name, p.category || '—', p.soldOut ? { text: 'Sold out now', tone: 'danger' } : { text: 'Available', tone: 'muted' }, sold.get(p.id) || 0]);
  return {
    title: 'Sold out & slow dishes',
    cols: [{ h: 'Dish' }, { h: 'Section' }, { h: 'Now' }, { h: 'Plates in period', r: true }],
    rows,
    foot: ['Total', '', rows.filter((x) => (x[2] as CellObj).text === 'Sold out now').length + ' sold out', sumCol(rows, 3)],
    rowRefs: dishes.filter((p) => p.soldOut || !sold.get(p.id))
      .sort((a, b) => Number(!!b.soldOut) - Number(!!a.soldOut) || a.name.localeCompare(b.name))
      .map((p) => ({ kind: 'product' as const, id: p.id })),
    searchable: true,
  };
};

/* --- Prescription register: every prescription-only drug sold, with what was seen --- */
RPT['rx-register'] = (db, from, to) => {
  const rows: Cell[][] = [];
  const rowRefs: (RowRef | null)[] = [];
  salesBetween(db, from, to).forEach((s) => {
    s.lines.forEach((l) => {
      if (!db.products.find((p) => p.id === l.productId)?.rxOnly) return;
      rows.push([shortDay(s.ts), s.no, l.name, l.qty, s.rx?.prescriber || { text: 'Not recorded', tone: 'danger' }, s.rx?.number || '—', s.rx?.patient || partyName(db, s.partyId) || '—']);
      rowRefs.push({ kind: 'sale', id: s.id });
    });
  });
  return {
    title: 'Prescription register',
    cols: [{ h: 'Date' }, { h: 'Sale' }, { h: 'Drug' }, { h: 'Qty', r: true }, { h: 'Prescriber' }, { h: 'Rx no.' }, { h: 'Patient' }],
    rows,
    foot: ['Total', '', '', sumCol(rows, 3), '', '', ''],
    rowRefs,
    searchable: true,
    note: rows.length ? undefined : 'No prescription-only drugs were sold in this period.',
  };
};

  return RPT;
}
