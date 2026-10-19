# Moving the phone's books to SQLite

Supersedes `PERSISTENCE_SPLIT_PLAN.md`. That plan splits the book into AsyncStorage keys, which still hits Android's AsyncStorage limits. Measurements from 2026-10-15 show those limits are reached within days at pharmacy volume.

## Why this has to change

Today the whole book is one JSON string under `genius.pos.v1` in AsyncStorage (see `src/data/storage.ts`). Every `commit()` rewrites that string.

We measured this with the app's own `commitSale()`, using a 3-line sale:

| | Per sale | 500 sales a day |
|---|---|---|
| Growth of the saved book | ~2.3 KB | ~1.1 MB a day |
| Size after one year | | ~400 MB of JSON |

Android's AsyncStorage has two limits that this growth breaks:

- **About 2 MB per value when it is read back** (Android's `CursorWindow`). Above that, `loadDB()` cannot read the book. It catches the error and returns `null`, so the app behaves as if the phone has no book.
  - At 500 sales a day, this happens after about **2 days**.
- **6 MB for all of AsyncStorage** by default. This app does not set `AsyncStorage_db_size_in_MB`. Above it, every save fails and `StorageKeeper` shows "Changes are not being saved".
  - At 500 sales a day, this happens after about **5 days**.

Even without those limits, two problems remain:

- **Saving gets slower as the book grows.** Every save serialises the whole book: a year's book is about 400 MB of JSON.
- **The phone would need to hold a year of data in memory.** The app keeps the full book in RAM, and around 400 MB of JSON becomes well over 1 GB in the JavaScript heap. Android stops apps long before that.

Splitting the data across more AsyncStorage keys does not fix any of this. A month's partition would be about 33 MB, which is still far over the per-value limit.

## Decisions

1. **Engine: `expo-sqlite`.** It is already a dependency. Use WAL mode and one database file per business: `genius-<businessId>.db`. AsyncStorage keeps only small preferences.
2. **`logic.ts` and the `commit()` API stay as they are.** All 86 mutators and 116 `commit()` call sites keep working on a plain `DB` object. Only `storage.ts` changes, plus a read layer for history (phase 2).
3. **Generic document tables, not one table per type.** This keeps the change small and keeps the JSON shapes that sync and backup already use:

   ```sql
   CREATE TABLE docs (
     coll TEXT NOT NULL,          -- 'sales', 'journal', 'movements', 'products' …
     id   TEXT NOT NULL,
     day  TEXT,                   -- yyyy-mm-dd, for date-ranged reads
     party TEXT, item TEXT,       -- filled for the collections that have them, for ledgers
     doc  TEXT NOT NULL,          -- the record as JSON, exactly as in DB today
     PRIMARY KEY (coll, id)
   );
   CREATE INDEX docs_day   ON docs(coll, day);
   CREATE INDEX docs_party ON docs(coll, party, day);
   CREATE INDEX docs_item  ON docs(coll, item, day);
   CREATE TABLE meta (key TEXT PRIMARY KEY, doc TEXT NOT NULL);  -- firm, settings, counters, session, sync …
   ```

4. **Only what changed is written.** A save writes only the records that changed, in one transaction. Changed records are found three ways:
   - **New records:** each array's length and last id are compared with the previous save.
   - **Edited records:** the ids named in the sync ops queued since the last save (`enqueue(kind, ref)` already records them).
   - **Master data** (`products`, `parties`, `accounts` …): each record is compared against a cached copy. A test proves this tracking is complete (see the tests below).
5. **Singletons** such as `settings`, `counters`, `session` and `sync` go to `meta`. Each is small and written whole when it changes.

## Phase 1 status (2026-10-16): built and tested; not yet released

### What was built

| File | What it does |
|---|---|
| `src/data/store/driver.ts` | The small SQLite interface: expo-sqlite on the phone, `node:sqlite` in tests. |
| `src/data/store/bookstore.ts` | The tables (`docs`, `meta`, `store`); loading the book; saving only what changed. |
| `src/data/store/track.ts` | Records which records each `commit()` changes, by wrapping the book in Proxies only while the change runs. |
| `src/data/storage.ts` | `loadDB`, `saveDB` and `clearDB` now use SQLite. It moves the old AsyncStorage book across once and checks it. |
| `src/data/AppDataContext.tsx` | `commit()` now runs every change through `trackedChange`. |
| `src/data/StorageKeeper.tsx` | Warns when an old book exists but Android could not read it. |

### How it decides what to save

Two decisions differ from the plan below:

- **Changed records are found by recording the change itself, not from the sync queue.** The queue is skipped when sync is off and does not say which list a record belongs to.
- **No fingerprints in memory.** Hashing every record took seconds at load. Instead:
  - small lists are compared by their JSON text;
  - for large lists, a rotating slice of 150 records per save is compared with what SQLite holds. This is the safety net for an edit the recorder could not see.
  - A search of all 91 `commit()` bodies found none that edit a record obtained outside the book.

### Falling back safely

- If SQLite cannot open on a phone, the app keeps using AsyncStorage exactly as before.
- If the moved book does not read back identical, the move is undone and the phone stays on AsyncStorage.
- The old key is kept as a rollback copy and is never written again.

### Measured

These figures come from `__tests__/bookstore.scale.test.ts`, using `node:sqlite` on a desktop, with 3-line sales:

| Sales in book | Records on disk | Save p50 | Save p95 | One change through `commit()` | Cold load |
|---|---|---|---|---|---|
| 5,000 | 11 MB | 26 ms | 35 ms | 18 ms | 0.3 s |
| 20,000 | 42 MB | 56 ms | 69 ms | 19 ms | 1.2 s |
| 60,000 | 123 MB | 63 ms | 75 ms | 22 ms | 4.4 s |

Saving now stays roughly flat as the book grows. The old way rewrote the whole book on every save, which is what broke Android within days.

The change recorder costs a flat ~20 ms per commit. That comes from the audit log, which adds new entries at the front. It is capped at 5,000 entries, so the cost does not keep growing.

**Cold load still grows with the book**, because the whole book is still read into memory. Phase 2 fixes that.

### Still to do before release

- [ ] Run it on a real low-end Android phone. Hermes runs Proxies more slowly than V8, so expect higher numbers than above.
- [ ] Rebuild a phone whose old book was too big to read, automatically from the sync server. Today the app only explains what happened and asks the user to sign in.
- [ ] Ship it behind a release note. The first launch of the new version moves the book across before the app opens.

## Phase 2 status (2026-10-16): foundation built, window switched OFF

The foundation is built. The window stays **off** (`setMemoryWindowDays(0)` in `storage.ts`) until the screens listed below are moved over.

### What is built

- **`loadBook({ sinceDay })`** loads three things:
  - master data;
  - every open sale and purchase, of any age;
  - the last N days of `sales`, `purchases`, `payments`, `entries`, `journal` and `movements`.
- **One "brought forward" journal entry per branch and account** stands in for everything older. SQL folds the older lines with `json_each`. These entries are never written or synced.
- **A save never deletes a row this session did not load or write.** With a window on, older history stays on disk and safe.
- **`readFullBook()` and `wholeBook(d)`** give backups and cloud snapshots the complete book from disk. `sealBook()` and `uploadSnapshot()` refuse a partial book, so they can never send one by mistake.
- **`history(coll, { from, to, party, item, limit, offset })`** reads older records from SQLite.

### Proven by `__tests__/bookwindow.test.ts`

The test uses 200 days of trade (cash and credit sales, purchases, payments against old invoices) and compares a 90-day window with the whole book:

- Every party balance, account balance, stock level and ledger total is **identical**.
- Every open credit invoice is in memory, whatever its age.
- Saving with the window on loses nothing on disk, and never writes the brought-forward entry.
- Backups refuse the partial book; `wholeBook()` returns the complete one.

### Progress, 2026-10-16 (later): window still OFF

**Done**

- **Backups and cloud snapshots use the full book.** `BackupKeeper`, `DataToolsScreen` (three places), `SyncScreen` and `useSyncRun` pass `wholeBook(db)` whenever the book is partial. With the whole book in memory nothing changes: backups stay immediate and the existing tests pass.
- **All 94 reports match the full book exactly with a window.** This holds over the last 30 days, and also over a period 150–120 days ago, which is read from disk.
  - The window keeps per-party totals of older sales, purchases and payments, computed in SQL with the party ledger's own formula. `broughtForward()` in reports.ts serves both the report and the ledger screen.
  - The brought-forward journal entry holds gross debit and credit per account, so the chart of accounts and the general ledger show the same totals.
  - It also lists the items that moved before the window, so stock-out days come out right.
  - `earliestRead()` returns the true start of what a report reads: AAMC and AAWC sample 90 and 56 days back from the end date.
- **`bookForRange(d, fromMs)`** builds a separate book from day X, with everything earlier brought forward (`loadBook({ detached: true })`). It is exact by the same proof, and only as large as the range.
- **`useBookFrom(live, fromMs)`** is a hook for screens. These now use it:
  - `ReportDetailScreen` (every report and drill-down; shows "Reading older records…" while it loads);
  - Accounting (`BooksScreens`) and Tax;
  - Finance;
  - Staff report;
  - Party ledger;
  - Money.

**Still blocking the switch.** The first item is the most important.

1. **Fetch records on demand before changing or opening them.**
   - Mutators look records up by id: 18 places in `logic.ts`, 5 in `AppDataContext` and 6 in `syncClient`. Voiding, editing, returning or reprinting an old *paid* sale would fail with "not found".
   - A remote op from another phone that touches such a record must not be dropped.
   - Needed: `ensureLoaded(coll, ids)`, which pulls rows from disk into the live lists before the change runs. It must be called from the void/edit/return paths, from detail screens opened with an id, and from `applyRemoteOps`.
2. **Lookups by id on screens:**
   - `InstalmentScreens` (the plan's sale);
   - `EstimateDetailScreen` (the converted sale);
   - `MoneyEntryScreens` (the offset bill);
   - `DeletedTransactionsScreen`.
3. **Lists with no date range:** `SalesListScreen`, `PurchasesScreen`, `CreditNotesScreen` and `CashEntriesScreen` need a "show older" control backed by `history()`.
4. **Counts over all time:** `UsersRolesScreen` shows a staff member's lifetime bill count, which needs a SQL count.
5. **History of one item:** `ItemDetailScreen` and `BatchMovementScreen` show stock movements for an item; use `history('movements', { item })`.

### Before the window can be switched on (original list)

1. **Six reports work out opening balances from older history.** They must read that history from SQLite:
   - customer balance summary;
   - supplier balance summary;
   - receivable statement;
   - party statement;
   - chart of accounts;
   - general ledger.

   Over a 30-day range, the other 88 of the 94 reports already match.
2. **Any report or screen covering a date range that starts before the window** must go to `history()`. This includes the party ledger, item detail and movements, the batch movement screen, the sales and purchase lists past 90 days, search, and the day summary for an old day.
3. **The five backup and snapshot calls must pass `wholeBook(db)`:**
   - `BackupKeeper`;
   - `DataToolsScreen` (three places);
   - `SyncScreen`;
   - `useSyncRun`.

   They are safe as they are, because `sealBook` refuses a partial book. With the window on, though, they would refuse until changed.
4. **Turn the window on behind a setting**, and run the equivalence test on a real device.

## Phase 1: the storage engine (about 1–1.5 weeks). Fixes the "breaks within days" problem.

- [ ] `src/data/store/sqlite.ts`: open the file, apply PRAGMAs (WAL, `synchronous=NORMAL`), create the tables, and handle schema versions.
- [ ] `src/data/store/tracker.ts`: works out what changed since the last save (decision 4).
- [ ] New `saveDB` and `loadDB` with the same signatures. `scheduleSave`, `flushSave` and save-status reporting keep their behaviour.
- [ ] Migration on the first launch after the update:
  - Read `genius.pos.v1` and write everything into SQLite in one transaction.
  - Verify record counts per collection and a stable hash of the reassembled `DB`.
  - Then stop writing to AsyncStorage. Keep the old key read-only for two releases as a rollback copy.
- [ ] **Recovery for books already too big to read.** Rebuild the phone from the sync server: a snapshot plus pulling ops. These are the shops whose books are online. Show a clear "restoring your books" screen while it runs.
- [ ] Backup, restore, export and `uploadSnapshot()` assemble the same logical `DB` as today, so the file formats and the sync contract are unchanged.
- [ ] Still loads the whole book into memory, as today. Phase 2 removes that.

**Gate before release** (run on a low-end Android profile):
- A save of a new sale takes under 100 ms at 95th percentile, on a synthetic year of 182,500 sales.
- Load succeeds at that size.
- No book loses a record in the round-trip test.

## Phase 2: memory and history (about 2–3 weeks). Makes a year of data comfortable.

- [ ] Load into memory only:
  - master data;
  - open documents (unpaid, held, open orders);
  - the last **90 days** of transactions;
  - the current shift and current financial year totals.
- [ ] A history API in `src/data/history.ts`:
  - `history(coll, { from, to, party, item, limit, after })` returns rows from SQLite.
  - `sum(coll, …)` returns aggregates without loading rows.
- [ ] Move the screens that read old data to this API: sales and purchase lists, party statements, item ledgers, the day book, reports with a date picker, and search. 42 files read `d.sales` today; most only need the in-memory window and do not change.
- [ ] `partyBalance()` loops over every sale and purchase. Replace it with a stored running balance, updated by the same mutators, plus an SQL check that can rebuild it. Product stock is already stored on the product.

**Gate:**
- Cold start under 3 s.
- JavaScript heap under 250 MB.
- Opening any report for a whole year under 2 s, all with a full synthetic year loaded.

## Phase 3: closed years (about 1 week)

- [ ] `startFinancialYear()` already carries balances forward. After a year is closed, its transactions may be removed from the phone once the sync server has confirmed it holds them.
- [ ] Reports for archived years fetch the data from the server.

## Tests to add

1. **Tracker completeness.** Run every exported mutator in `logic.ts` on a fixture. Assert that the tracked change set equals a full before/after diff. This catches a future mutator that edits an old record without queuing an op.
2. **Round-trip.** Monolith → SQLite → `DB` gives an identical normalised result for every fixture, including old ones that lack newer fields.
3. **Crash safety.** Kill the app between the statements of a save. The previous complete state must load.
4. **Scale.** Build 182,500 synthetic sales and record save p95, load time, heap size and report times. Commit the numbers next to this plan.

## Not in scope here

The Windows desktop has its own version of this problem. It uses sql.js, which rewrites the whole database file on every save, so a sale took 2.5–3.4 s on a one-year file of 381 MB. The fix there is a native SQLite engine, which needs a newer Electron (Node 22). That is planned separately.

### 2026-10-16: fetch on demand built
- `faultIn` (bookstore.ts) → `ensureLoaded` (storage.ts) → `ensureLoaded` on the app context → `useOnDisk` hook.
- Sale, purchase and payment detail screens read an older record in when it is missing, so Edit/Void/Return work on it.
- Test: reading in old records doubles no figure; a change to one saves; nothing is lost or duplicated on full reload.
- Still before switch-on: by-id lookups on InstalmentScreens, EstimateDetailScreen, MoneyEntryScreens, DeletedTransactionsScreen; "Show older" on the list screens; item history and bill counts via SQL; window setting + device test.
- By-id lookups done: instalment plan's sale and an estimate's converted sale use `useOnDisk`; deleted-but-not-purged sales/purchases always load (OPEN_SQL), so the Deleted screen is complete; money-entry offset bills are open bills, already in memory. Tested.
- List screens done: Sales, Purchases, Cash in/out and Returns read the chosen period from disk (useBookFrom) when it starts before memory; tapping an old row opens it via useOnDisk.
- Item history and counts done: ItemDetail and BatchMovement add older movements from disk (useOlderRows/withOlder); the user sheet bill count adds countOnDisk. Tested. Left: window setting, device test, APK.
- 2026-10-16: window setting in Data tools ("Records in memory": Everything/1 year/6 months/90 days, saved in store table, applies next start). Test APK C:\Users\Amar\Downloads\GeniusPro-window-test.apk built locally, not published. Waiting on device test.
