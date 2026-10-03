/**
 * Writes a real phone book for the Windows till's import test.
 *
 * The Windows till can open a business that started on the phone
 * (GENIUS PRO POS WINDOWS, modules/phonesync, "bring a phone business in").
 * Its test needs a book this app actually produces — not one written by hand
 * to look like one — and the figures this app reports for it, to check the
 * import against. This writes both: the demo shop (75 days of generated
 * trading, built by the real mutators) and what the phone says it holds.
 *
 * Skipped unless PHONE_BOOK_OUT names the file:
 *   PHONE_BOOK_OUT=/path/phone-book.json npx jest exportForWindows
 */
import * as fs from 'fs';
import { seed } from '../seed';
import { migrate } from '../storage';
import * as logic from '../logic';

const OUT = process.env.PHONE_BOOK_OUT;
const maybe = OUT ? it : it.skip;

maybe('writes the demo shop and what the phone says it holds', () => {
  const db = migrate(seed());
  const wh = db.warehouses[0].id;
  const expected = {
    warehouse: wh,
    stock: Object.fromEntries(db.products.map((p: any) => [p.name, logic.stockOfImpl(p, wh)])),
    sales: db.sales.filter((s: any) => (s.warehouse || wh) === wh).length,
    customers: Object.fromEntries(db.parties.filter((p: any) => p.type === 'customer')
      .map((p: any) => [p.name, logic.partyBalance(db, p.id)])),
  };
  fs.writeFileSync(OUT!, JSON.stringify({ book: db, expected }));
  expect(db.products.length).toBeGreaterThan(0);
});
