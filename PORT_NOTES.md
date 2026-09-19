# Genius POS — React Native port notes

## What this is
A React Native / Expo (TypeScript) port of the "Genius POS" web prototype
(`artifact-90c4da7b-1789120732-196a.html`, ~24k lines). The prototype is a large,
iteratively-evolved single-file app with 100+ screen definitions (many are
superseded/overwritten later in the file — `SCREENS.xxx = {...}` appears
repeatedly for the same key). This port targets the scope described in the
build brief: the core billing/POS workflow, not every one of the ~100 screen
variants found in the raw file.

## Source material read
- Full CSS design-system block (`:root` custom properties, light + dark themes,
  component classes for cards/rows/pills/buttons/inputs/sheets/receipts/etc.) —
  ported into `src/theme/colors.ts` and `src/theme/index.ts`.
- `seed()` and the whole data layer (`src/data` region of the HTML, lines
  ~662–1300): products, parties, users, accounts, warehouses, settings,
  loyalty rules, session, counters, and the business-logic functions
  (`commitSale`, `voidSale`, `purchaseIn`, `recordPayment`, `recordEntry`,
  `journal`, `partyBalance`, stock `move`) — ported faithfully into
  `src/data/seed.ts` and `src/data/AppDataContext.tsx`.
- `TABS` / router structure (lines ~1514–1560) — used to derive the bottom-tab
  layout (owner vs cashier tab sets, center FAB "new sale" tab).
- Full list of `SCREENS.*` keys (grepped across the file) — used to choose
  which screens to build for this scope.

## File layout
```
App.tsx                        — font loading, providers, entry point
src/theme/colors.ts            — light/dark color tokens (from CSS custom properties)
src/theme/index.ts             — spacing, radius, font family constants, useTheme()
src/data/types.ts              — TypeScript types for every entity
src/data/uid.ts                 — id/date helpers, mulberry32 PRNG (matches prototype's seeded RNG)
src/data/seed.ts                — seed() port: demo firm, products, parties, users,
                                   accounts, 75 days of generated sale/purchase history
src/data/storage.ts             — AsyncStorage read/write, key "genius.pos.v1"
src/data/AppDataContext.tsx     — React Context: DB state + actions (commitSale,
                                   voidSale, createPurchase, recordPayment, recordEntry,
                                   updateProduct/Party, resetAll, etc.) — mirrors the
                                   prototype's mutation functions and ledger logic
src/components/ui.tsx           — Card, Row, Pill, Button, StatTile, Chip, Cap, Empty, Screen
src/nav/types.ts                — RootStackParamList / TabParamList
src/nav/MainTabs.tsx             — bottom tabs incl. raised center FAB ("+") that opens New Sale
src/nav/RootNavigator.tsx        — root stack: Welcome → Onboarding/PinLock → Main → detail screens
src/screens/*.tsx                — one file per screen (see below)
```

## Screens implemented
Welcome, PinLock (numeric keypad + dot indicators, per-user), Onboarding
(business name / currency / tax wizard), Dashboard (today/7-day sales, stock
value by category, low-stock list, quick actions), New Sale / POS (category
chips, product grid, cart with qty steppers, cash/momo/bank/credit, receipt),
Receipt (thermal-style mono receipt), Sales list + Sale detail (with void),
Products list + Product detail/edit (emoji picker, per-warehouse stock),
Parties list + Party detail/edit + Party ledger (running balance), Money
(accounts, record payment, recent payments), Purchases list + New purchase,
Reports (date-range chips, sales by method, top products, stock value/low
stock), More/Menu hub (with inline Settings toggles for EFRIS, low-stock
alerts, require-shift, dark-mode override, and an online/offline/sync
banner), Users & Roles (grouped, editable permission checkboxes), Business &
Branches, Warranties & Claims, Subscription Plans (pricing cards).

Added in the second pass: Estimates (+ new), Delivery challans (+ new),
Credit notes & returns (+ new), Offers (+ new), Stock-takes (+ detail/count/
post), Purchase orders (+ new/receive), Production (BOM assembly runner),
Recurring invoices (+ new, due-now list), Shift open/close, Businesses
(multi-firm switch), Audit log, About & license.

## Business logic preserved
- Double-entry journal (`n_sales`, `n_cogs`, `n_inventory`, `n_ar`, `n_ap`,
  `n_tax`, `n_discount`, `n_loyalty`, `n_equity`, `n_expense`, `n_income`)
  posted on every sale, void, purchase, payment, and manual entry — same
  nominal account ids as the prototype.
- Stock movements per warehouse decrement/increment on sale/void/purchase.
  `commitSale` creates warranty records for items with `warrantyMonths > 0`.
- `partyBalance`, `accountBalance`, party ledger running-balance rows, FIFO
  payment application against oldest open sale/purchase — all ported.
- Loyalty points earn/redeem using the same `earnPer` / `pointValue` rules.
- Demo history generator uses the same seeded `mulberry32` PRNG and produces
  ~75 days of sales/purchases so Reports/Dashboard have real numbers on first run.

## Second pass — gaps closed (everything except EFRIS)
All items from the original gaps list have now been implemented, per
explicit instruction to skip EFRIS (Uganda e-invoicing) entirely.

- **Estimates/quotations** — `src/screens/EstimatesScreen.tsx` +
  `EstimateNewScreen.tsx`, `createEstimate`/`convertEstimate`/`voidEstimate`
  in `AppDataContext`. Converting posts a real sale via the shared
  `commitSale` logic.
- **Delivery challans** — `ChallansScreen.tsx` (+ `ChallanNewScreen`),
  `createChallan`/`markChallanDelivered`.
- **Credit notes / returns** — `CreditNotesScreen.tsx` (+
  `CreditNoteNewScreen`), `createCreditNote` restocks the warehouse, posts a
  reversing journal entry, and reduces the linked sale's due (or the
  party's opening balance when not linked to a sale).
- **Offers** — `OffersScreen.tsx` (+ `OfferNewScreen`), percent/fixed,
  scoped to all/category, with `bestOfferFor(product)` selector wired for
  POS use (not yet auto-applied inside the cart total — see caveat below).
- **Stock-takes** — `StockTakesScreen.tsx` + `StockTakeDetailScreen`,
  `startStockTake`/`setStockTakeCount`/`postStockTake`; posting adjusts
  stock per product and books the variance to `n_income`/`n_expense`.
- **Purchase orders** — `PurchaseOrdersScreen.tsx` (+
  `PurchaseOrderNewScreen`), `createPurchaseOrder`/`receivePurchaseOrder`
  (receiving creates a real purchase via `createPurchase`).
- **Production runs (BOM assembly)** — `ProductionScreen.tsx`,
  `runProduction(productId, qty)` consumes each `bom` component's stock,
  produces the finished good, and posts a balanced inventory-to-inventory
  journal entry (with the cost/price difference booked to income/expense).
- **Recurring invoices** — `RecurringScreen.tsx` (+ `RecurringNewScreen`),
  `scheduleRecurring`/`updateRecurring`/`dueRecurring`/`runRecurring`; the
  list screen surfaces a "due now" section and a manual "Run now" action.
- **Shift open/close** — `ShiftScreen.tsx`, `openShift`/`closeShift`/
  `activeShift`, using the existing `DB.shifts` array; close shows
  expected-vs-counted cash and over/short.
- **Multi-firm switching** — `DB.firms`/`activeFirmId` added alongside the
  existing single `DB.firm`; `FirmsScreen.tsx`, `addFirm`/`switchFirm`.
  Kept separate from `BusinessScreen` (branches within the active firm).
- **Audit log** — `DB.auditLog`, `logAudit`, and an `audit()` helper now
  called from every significant mutation (sale create/void, purchase,
  payment, stock-take post, production run, estimate/challan/credit-note/PO
  lifecycle, user/role change, shift open/close, firm switch, online/offline
  toggle). `AuditLogScreen.tsx` lists/filters it.
- **Barcode scanning** — `expo-camera` installed;
  `src/components/BarcodeScannerModal.tsx` wraps `CameraView` with
  permission handling and a graceful fallback (manual entry) if the camera
  module isn't available on a given platform/build. Wired into
  `ProductsScreen` (search-by-scan) and `NewSaleScreen` (scan-to-add-to-cart
  by SKU).
- **Batch/serial tracking** — `Product.trackBatches`/`batches` and
  `trackSerials`/`serials` added to the type; `ProductDetailScreen` has an
  editor for both (mutually exclusive per product, matching the common
  real-world case). Not yet consulted during sale/purchase line entry to
  force picking a specific batch/serial — see caveat below.
- **Install/update/licence** — `AboutScreen.tsx` (app version via
  `expo-constants`, active plan reusing `DB.plans`, install/platform info),
  reachable from More → Account.
- **Offline queue / sync indicator** — `DB.queue`, `toggleOnline`,
  `flushQueue`; `commitSale`/`createPurchase`/`recordPayment` push a queue
  entry when `session.online` is false. `MoreScreen` shows a live
  online/offline banner with pending count and a manual "Go
  offline/online" / "flush" toggle (mirroring the prototype's `toggleNet`
  sidecar control); going back online auto-flushes.
- **Full onboarding wizard** — `OnboardingScreen.tsx` rewritten as a 6-step
  wizard: business type grid (`.typecard`-style cards) → business details →
  branch name → currency/tax → owner PIN → done.
- **Users & Roles permission editor** — `UsersRolesScreen.tsx` now renders
  grouped, individually toggleable permission checkboxes (Sales/Stock/
  Money/Parties/Reports/Admin) per role, instead of a static pill list.
  Note: permission state is in-memory (component state) since the DB schema
  has no per-role permission-matrix field yet — toggling it doesn't persist
  across app restarts. Wiring it into `DB`/`AppDataContext` as a persisted,
  enforced ACL is the natural next step.
- **Dark mode manual toggle** — `useTheme()` now reads `settings.theme` and
  overrides `useColorScheme()` when set to `'light'`/`'dark'`; a 3-way
  chip toggle (Auto/Light/Dark) lives in More → Settings.
- **Automated tests** — Jest (`jest-expo` preset) configured; the core
  double-entry business logic (`commitSale`, `voidSale`, `createPurchase`,
  `recordPayment`, `postStockTake`, `runProduction`, recurring due
  calculation + run, offline queue flush) was extracted from
  `AppDataContext` into a framework-free module, `src/data/logic.ts`, so it
  can be unit-tested without rendering React/React Native at all.
  `src/data/__tests__/logic.test.ts` has 17 passing tests covering stock
  movement, journal balance, party balance/AR, payment application/capping,
  stock-take variance in both directions, BOM consumption and insufficient-
  stock refusal, recurring due-flagging and period advancement, and queue
  flush. Run with `npm test`.

## Remaining simplifications / honest caveats
- **EFRIS** was explicitly left untouched (out of scope by instruction).
- Offers are computed (`bestOfferFor`) but **not yet auto-applied** inside
  the POS cart total in `NewSaleScreen` — an offer can be created/managed
  but a cashier doesn't see it discount the cart automatically yet.
- Batch/serial data is captured on the product record but **sale/purchase
  line entry doesn't yet prompt to pick a specific batch/serial** — stock
  quantity moves at the whole-product level as before.
- The Users & Roles permission checkboxes are **not persisted or enforced**
  anywhere else in the app (no screen currently checks a permission before
  allowing an action) — it's a working editor UI over an otherwise-inert
  permission set, ready to be wired to real gating later.
- Barcode scanning **could not be tested against a physical camera** in
  this environment; the permission flow, unsupported-platform fallback, and
  wiring were verified by code review and `tsc`/`expo-doctor`, not by
  scanning a real barcode. `expo-camera`'s `CameraView`/`useCameraPermissions`
  API matches the installed SDK 57-compatible version.
- Multi-firm switching swaps the single `DB.firm` pointer used everywhere
  else in the app (receipts, Business & Branches, etc.); it does **not**
  give each firm its own separate products/parties/sales — that would be a
  much larger data-partitioning change. This matches "hold multiple
  firm/business records and switch the active one" at the firm-identity
  level, not full multi-tenant data isolation.
- `AppDataContext.tsx` still owns everything not covered by the
  `logic.ts` extraction (estimates, challans, credit notes, offers,
  purchase orders, shifts, firms, audit log plumbing) inline — only the
  functions explicitly required for the test suite were pulled out, to
  keep the refactor scoped and low-risk on top of an already-large change.

## How to run
```
npm install   (already done)
npx expo start
```
Press `a`/`i`/`w` for Android/iOS/web, or scan the QR code with Expo Go.
First launch seeds demo data into AsyncStorage under key `genius.pos.v1`.
"Reset demo data" in More clears and reseeds it.

Run the test suite with:
```
npm test
```

## Verification performed
- `npx tsc --noEmit` — passes, no errors.
- `npx expo-doctor` — 21/21 checks passed.
- `npm test` — 17/17 Jest tests passed (`src/data/__tests__/logic.test.ts`).

---

## Final pass — the "last definition wins" correction

The first two passes built several screens from **superseded** definitions.
The prototype reassigns the same keys repeatedly (`SCREENS.x = {...}`, then
later `SCREENS.x.body = ...`, and wrapper forms
`SCREENS.x.body = (function(base){ ... })(SCREENS.x.body)`). Only the **last**
assignment is live. Corrected sources now used:

| Screen   | Live definition |
|----------|-----------------|
| Dashboard| 6289            |
| Finance  | 12624 (`finance.body` reassigned) |
| Items    | 13154 (`stock.body`) + `items = stock` at 13209, `items.right` at 17146 |
| Menu     | 6565 base + wrappers at 12505 / 12515; `audit` spliced in at 17957 |

Consequences: the tab bar is four tabs around a centre FAB
(Dashboard · Finance · [+] · Items · Menu, same for every role), Items has no
button row (those actions live in the FAB sheet), and Menu is a 2-column grid
of six group cards drilling into `menuGroup`, not a flat list.

## Completed in the final pass
- Shared `AppBar` used by every screen; four-tab bar + centre FAB; `quickAll`
  sheet with the full QUICK catalogue (EFRIS omitted).
- Dashboard / Finance / Items / Menu / MenuGroup rebuilt against the live
  definitions, incl. the SVG arc gauge and week rings.
- Permissions (`src/data/perms.ts`) actually gate screens, menu items and
  quick actions.
- Printing (persisted via `DB.printer`/`printers`/`templates`), instalment
  plans (real schedules, `createInstalmentPlan` / `payInstalment`), bulk
  changes (price / rename / activate / tags, each with a preview step),
  and the licence / install / update / sync / versions / about screens.
- Audit log restored to the Business menu group (reference 17957).
- Branch switching made functional (`setWarehouse`), reachable from the
  Menu's "Selling from" row.
- Sale detail gained a "History" entry into the Versions screen.
- A blocked licence routes to `LicenceStop` at startup (`licBlocks`).
- Removed superseded files: `MoreScreen.tsx`, `ProductsScreen.tsx`,
  `AboutScreen.tsx`, `PlansScreen.tsx`.

## Verification
`npx tsc --noEmit` clean · `npm test` 17/17 · `npx expo-doctor` 21/21 ·
`npx expo export --platform android` bundles (2.9 MB).
A route sweep (every `go(...)` / `navigate(...)` / menu `route:` against the
registered stack) reports **zero dead ends**.

## Still outstanding
- EFRIS is deliberately absent throughout (user's instruction).
- Tests cover the data layer only (17 cases); no instalment-schedule or
  bulk-change unit tests yet, and no UI tests.
- Offers are computed but not auto-applied to the POS cart total.
- Batch/serial data is captured per product but sale/purchase line entry does
  not yet prompt for a specific batch or serial.
- Role permission edits are stored but not enforced beyond the `can()` gates
  listed above.
- Barcode scanning is code-complete but untested against a real camera.
- Multi-firm switching swaps the active firm record; it does not partition
  products/parties/sales per firm.
