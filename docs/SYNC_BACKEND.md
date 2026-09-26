# Genius POS — sync and licence server

For the local persistence migration plan behind this sync design, see
[`docs/PERSISTENCE_SPLIT_PLAN.md`](PERSISTENCE_SPLIT_PLAN.md).

A design for the server that will run on a cloud VPS: multi-tenant, keyed to the
owner's email address, holding both the shops' books and their licences.

This is written against the app as it stands, not against a generic POS. Where
the client already has a field or a concept that this design needs, it is named,
because the two must not drift apart.

---

## 1. What the server is for

Three jobs, in order of how much it hurts to lose them:

1. **Not losing the books.** Today the only copy of a shop's trading lives in one
   AsyncStorage key on one phone. A dropped phone is the whole business.
2. **More than one till.** A shop with a counter and a stall cannot work if each
   device holds a different truth.
3. **Licensing.** Knowing which owner has paid, for how many devices, and until
   when — and saying so to a device that may be offline for a fortnight.

It is explicitly **not** the place where business rules live. The app decides
whether a sale is allowed; the server records that it happened. A server that
starts arbitrating stock will disagree with the till in front of the customer,
and the till is the one holding the money.

---

## 2. Identity and tenancy

```
account            the owner's email — what a licence attaches to
 └── business       a tenant; one row per entry in the app's DB.firms[]
      └── branch    one row per DB.warehouses[] entry; own stock, own books
           └── device  a phone or tablet running the app
```

**The account is the owner's email address.** It is the login, the licence
holder and the billing party. One account may hold several businesses — the app
already supports this through `DB.firms[]`, `DB.activeFirmId` and the "Work in
another business" row on the menu.

**The business is the tenant boundary.** Every row of shop data carries
`business_id`, and no query ever crosses it.

**The branch is not a tenant** but it is the accounting boundary inside one. The
app now treats a branch as a separate business — own stock, own drawer, own
books, own document prefix — so `branch_id` travels on every operation and the
server preserves it faithfully. It does not aggregate across branches; the app
does that itself when the owner asks for a cross-branch view.

**Staff are not server identities.** Staff sign in to the *app* with a local PIN.
The *device* is what authenticates to the server. This matters: a cashier must be
able to start a shift on a phone with no signal, and giving every cashier a
server account would make that impossible. The staff id rides along on each
operation for attribution, and that is all.

### Isolation strategy

Row-level: `business_id` on every table, plus Postgres row-level security as a
backstop.

Rejected alternatives, and why:

- **Database per tenant** — a VPS holding a few hundred small shops would need a
  few hundred connection pools and a few hundred migration runs. The operational
  cost lands on one person.
- **Schema per tenant** — same migration problem, less isolation benefit than it
  appears once the API is the only thing talking to the database.

RLS is the belt to the API's braces: if a handler ever forgets its `WHERE
business_id = $1`, the database still returns nothing. The API sets
`SET LOCAL app.business_id` from the token, never from the request body.

---

## 3. What gets synced, and what must never be

This is the most important decision in the design, and the app's existing shape
mostly makes it for us.

### Facts — an append-only operation log

Sales, purchases, payments, cash entries, journal postings, stock movements,
credit notes, stock takes, shifts. These are **things that happened**. They are
never edited in place: the app already voids and re-posts rather than mutating a
sale. Append-only data cannot conflict, which is why this is the bulk of the
sync and why it is simple.

### Settings — last write wins

Products, parties, price lists, roles, offers, printer setup, business details.
Low write frequency, and a genuine conflict ("two people renamed the same item")
is rare and cheap to resolve. Each such record carries a `rev` integer; a push
with a stale `base_rev` is rejected and handed the current row, which the client
resolves according to `SyncCfg.conflict`, a field it already has
(`'server' | 'device' | 'ask'`).

### Folds — never synced at all

**`product.stock[branchId]` must never go over the wire as a number.** Nor must
any account or ledger balance. These are folds:

- stock is the sum of `Movement` rows for that product and branch;
- an account balance is the sum of journal lines, which is literally how
  `accountBalance()` and `ledgerBalance()` are written today.

Sync the movements and the postings; recompute the totals on each device. If the
absolute stock number were synced, two tills each selling one unit would each
write "9 left" and the shop would lose a unit every time. This is the failure
that makes home-grown POS sync unusable, and the app is already built the right
way to avoid it — the design just has to not undo that.

The client's `migrate()` already recomputes nothing today because everything is
local; a device applying pulled operations must run the same folds it runs now.

---

## 4. The operation log

### Envelope

Every mutation the app makes becomes one operation:

```jsonc
{
  "op_id":     "9b1f…",        // uuid, generated on the device
  "business":  "biz_…",
  "branch":    "wh_a1b2c3",    // the app's local warehouse id
  "device":    "dev_…",
  "user":      "u_3",          // the local staff id, for attribution
  "kind":      "sale.commit",
  "ts":        "2026-09-18T14:03:11.220Z",   // device clock
  "lamport":   10482,          // per-device counter, for causal order
  "schema":    7,              // DB SCHEMA_VERSION the payload was written at
  "payload":   { /* the whole record, as the app stores it */ }
}
```

`op_id` is generated on the device and is the **idempotency key**. Pushing the
same operation twice is free. This is not a nicety: on a connection that drops
mid-request the device cannot know whether the sale landed, and without an
idempotency key its only safe options are to lose the sale or to double it.

### Ordering

The server assigns `seq`, a per-business monotonic counter, on acceptance. That
gives every business a single total order. Clients pull with
`?since=<seq>`, which is what `SyncCfg.cursor` already holds.

`lamport` is kept for causal ordering *within* a device and for tie-breaking
when two devices' clocks disagree — phone clocks in the field are routinely
minutes out, so `ts` is treated as information, never as an ordering key.

### Operation kinds

Named after the app's own mutators so there is no translation layer to get
wrong:

| Group | Kinds |
|---|---|
| Sales | `sale.commit`, `sale.void`, `sale.edit`, `sale.delete` |
| Buying | `purchase.create`, `purchase.void`, `po.create`, `po.receive` |
| Money | `payment.record`, `entry.record`, `transfer.record`, `journal.post` |
| Stock | `stock.move`, `stock.adjust`, `stocktake.post`, `production.run` |
| Returns | `creditnote.create` |
| Till | `shift.open`, `shift.close` |
| Branch | `branch.open`, `branch.update`, `branch.disable` |
| Records | `record.upsert` (LWW: products, parties, roles, settings, …) |
| Housekeeping | `audit.append` |

A server that does not recognise a `kind` **stores it and passes it on**. An
older server must never drop an operation from a newer app; it is not the
server's business to understand a sale in order to keep it safe. Only the
projection step (§6) needs to understand kinds, and it may skip what it does not
know.

---

## 5. The API

Small on purpose. Everything is JSON over HTTPS, gzipped.

### Auth

```
POST   /v1/auth/register        { email, password, businessName }
POST   /v1/auth/login           { email, password } → { access, refresh, account }
POST   /v1/auth/refresh         { refresh } → { access }
POST   /v1/auth/otp/request     { email }            // for people without a password manager
POST   /v1/auth/otp/verify      { email, code }
POST   /v1/auth/password/reset  { email }
```

Passwords hashed with argon2id. Access tokens are short-lived JWTs (15 min);
refresh tokens are opaque, stored hashed, and bound to one device.

### Devices — these are the licence seats

```
POST   /v1/devices              { name, kind, platform } → { device, token }
GET    /v1/devices              → seats, last seen
DELETE /v1/devices/:id          revoke a seat
```

Seat limits are enforced **here and only here**. See §7.

### Businesses

```
GET    /v1/businesses
POST   /v1/businesses           { name, tin, address }
```

### Sync

```
POST   /v1/sync/push            { ops: Op[] } → { accepted[], rejected[], seq }
GET    /v1/sync/pull?since=&limit=500 → { ops[], seq, more }
GET    /v1/sync/state           → { seq, ops, lastPush, lastPull }
POST   /v1/sync/numbers/lease   { branch, kind, size } → { from, to }
```

`push` returns per-operation results, never a bare 200. A rejected operation
comes back with a reason the app can show a human:
`{ op_id, reason: 'stale_rev' | 'bad_schema' | 'unknown_branch', current? }`.

`pull` is cursor-paged. A device that has been off for a month walks the cursor
rather than asking for everything at once, so one shop cannot pin the VPS.

### Bootstrap and backup

```
POST   /v1/snapshots            full DB blob, gzipped → { id, seq }
GET    /v1/snapshots/latest     → { url, seq }
```

A fresh device restores the latest snapshot, sets `cursor` to that snapshot's
`seq`, then pulls forward. Replaying two years of operations onto a cheap phone
is not a plan; snapshots are.

This doubles as the off-device backup the app currently promises and does not
deliver. (The Cloud sync screen was recently made honest about this — it now
says the books exist only on the phone. This endpoint is what lets it stop
saying that.)

### Licence

```
GET    /v1/licence              → { token, record }
POST   /v1/licence/activate     { key }
POST   /v1/licence/heartbeat    → refreshed token
```

---

## 6. Database

Postgres 16.

```sql
create extension if not exists citext;    -- case-insensitive email
create extension if not exists pgcrypto;  -- gen_random_uuid()

create table accounts (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique,          -- the owner; licences hang off this
  password_hash text,
  name          text,
  status        text not null default 'active',  -- active | suspended | closed
  created_at    timestamptz not null default now()
);

create table businesses (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete restrict,
  name        text not null,
  tin         text,
  local_id    text,            -- the app's DB.firm.id, so a device can match them up
  status      text not null default 'active',
  created_at  timestamptz not null default now()
);
create index on businesses (account_id);

create table branches (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  local_id    text not null,   -- the app's warehouse id, e.g. 'wh_a1b2c3'
  name        text not null,
  prefix      text,            -- document prefix: LAKE-00042
  active      boolean not null default true,
  unique (business_id, local_id)
);

create table devices (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  business_id   uuid references businesses(id) on delete cascade,
  name          text not null,
  kind          text not null default 'phone',   -- phone | laptop
  platform      text,
  refresh_hash  text not null,
  last_seen     timestamptz,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
create index on devices (account_id) where revoked_at is null;

-- the log: append only, never updated
create table ops (
  seq          bigint generated always as identity,
  business_id  uuid not null references businesses(id) on delete cascade,
  op_id        uuid not null,
  branch_local text,
  device_id    uuid not null references devices(id),
  user_local   text,
  kind         text not null,
  client_ts    timestamptz not null,
  lamport      bigint not null default 0,
  schema_v     int not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  primary key (business_id, seq),
  unique (business_id, op_id)                    -- idempotency
);
-- the primary key already covers (business_id, seq), which is the pull path
create index on ops (business_id, kind, client_ts);

-- the projection: current state of the mutable records, for fast bootstrap
create table records (
  business_id uuid not null references businesses(id) on delete cascade,
  coll        text not null,     -- 'products' | 'parties' | 'roles' | 'settings' | …
  rec_id      text not null,     -- the app's own id
  rev         int  not null default 1,
  doc         jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references devices(id),
  primary key (business_id, coll, rec_id)
);

-- document number blocks, so two offline tills cannot issue the same number
create table number_blocks (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  branch_local text not null,
  kind         text not null,    -- 'sale' | 'purchase' | 'creditNote' | …
  lo           bigint not null,
  hi           bigint not null,
  device_id    uuid not null references devices(id),
  issued_at    timestamptz not null default now()
);
create index on number_blocks (business_id, branch_local, kind);

create table snapshots (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  device_id   uuid references devices(id),
  seq         bigint not null,
  bytes       bigint not null,
  storage_key text not null,     -- object storage, not this disk
  created_at  timestamptz not null default now()
);

create table licences (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  key         text unique,
  plan        text not null,     -- starter | pro
  term        text not null,     -- monthly | yearly | perpetual
  seats       int  not null default 1,
  status      text not null,     -- active | trial | expired | revoked | blocked
  started_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  note        text
);
create index on licences (account_id);
```

### Row-level security

```sql
alter table ops     enable row level security;
alter table records enable row level security;

create policy ops_tenant on ops
  using (business_id = current_setting('app.business_id')::uuid);
create policy records_tenant on records
  using (business_id = current_setting('app.business_id')::uuid);
```

The API sets `SET LOCAL app.business_id` per transaction, from the access
token's claims. **Never from the request body** — a client that can name its own
tenant has no tenancy at all.

### Growth

`ops` is the only table that grows without limit. A busy shop writes on the order
of a few hundred operations a day, so a single business is measured in tens of
megabytes a year — but a VPS holding hundreds of shops should still plan for it:

- keep 18 months of operations in Postgres;
- take a snapshot per business per week;
- archive operations older than the newest snapshot to object storage as
  compressed JSONL, and keep them — the app's accountability features and audit
  log mean deleting history outright would be the wrong answer;
- partition `ops` by `business_id` hash (8 or 16 ways) if a single table gets
  uncomfortable. Do this when measured, not before.

---

## 7. Licensing

The requirement is that the licence follows the owner's email. It does, and the
account row *is* the licence holder.

### Shape

The server issues a **signed licence token** — compact JWS, Ed25519. The app
embeds the public key and verifies it **offline**:

```jsonc
{
  "sub":    "acct_uuid",
  "email":  "owner@example.com",
  "plan":   "pro",
  "term":   "yearly",
  "seats":  3,
  "features": ["multiFirm", "sync", "secondaryUnit"],
  "businesses": ["biz_uuid_1", "biz_uuid_2"],
  "iat":    1789…,
  "exp":    1792…,           // ~30 days out; refreshed on every sync
  "jti":    "…"
}
```

The token's `exp` is short relative to the *subscription*: a yearly plan issues a
fresh 30-day token on every heartbeat. This means revocation takes effect within
a month without the app needing a live connection, and a shop that goes offline
keeps working from the token it already holds.

### The rule that matters

**An expired licence must never stop a shop selling.** A POS that locks the till
because a card payment failed in another country is a POS that gets thrown in a
drawer. Degradation, in order:

| State | What happens |
|---|---|
| `active` | Everything. |
| `trial` | Everything, with a countdown. |
| `stale` | Token past `exp` but inside the grace window (14 days). Everything still works; a banner asks for a connection. |
| `expired` | Past grace. **Selling, printing and taking payment keep working.** Reports, exports, bulk editors, branch management and sync go read-only. |
| `toomany` | Seat limit hit. The **newest** device is refused at registration. A device already trading is never cut off. |
| `revoked` / `blocked` | As `expired`, plus a message naming the reason. |
| `unbound` | The token's account does not match the book on this device. Read-only until resolved. |

These are exactly the values the client's `LicStatus` union already carries, and
`Licence.offlineSince` is already there to drive the grace window.

### Seats

A seat is a device, counted per account across all its businesses. Enforcement
happens at `POST /v1/devices` and nowhere else. Sync never checks seats — a till
in the middle of a market day must not start failing because the owner added a
phone at home.

Freeing a seat is `DELETE /v1/devices/:id`, which revokes the refresh token. The
revoked device keeps its local books (they are the shop's, not ours) and stops
syncing.

### Billing

Deliberately out of scope here. The licence table is written by whatever takes
the money — a payment webhook, or the owner's own hand via an admin endpoint.
Keeping billing out of the sync server means a payment outage cannot take the
books down with it.

---

## 8. Document numbers

A real problem the moment there are two tills, and one the app has already half
anticipated with `DB.numberSafe.mode`.

Today `counters.sale` is a local integer. Two offline tills in one branch will
both issue `INV-00042`. Branch prefixes (added with the branch work) fix
*cross-branch* collisions but not two devices in one branch.

**Leases.** A device asks for a block:

```
POST /v1/sync/numbers/lease { branch: 'wh_a1b2', kind: 'sale', size: 100 }
→ { lo: 4200, hi: 4299 }
```

It consumes the block offline and asks for another when it drops below a
threshold. Blocks never overlap, so numbers are unique by construction with no
coordination at the moment of sale.

**When a device runs out offline**, it falls back to
`numberSafe.mode = 'tag'` — `INV-T2-00007`, tagged with the till. Ugly on a
receipt, but unique, and far better than two customers holding the same invoice
number. `mode: 'plain'` (keep counting and risk it) should be reserved for
single-device shops that have turned sync off.

Gaps in the sequence are expected and must not be treated as an error: a device
that leases 4200–4299 and sells eleven things leaves a hole. Any report that
audits number continuity needs to know this.

---

## 9. Two tills, one last unit

Worth stating plainly because it is the question every shopkeeper asks.

Both tills are offline. Both sell the last bag of sugar. Both come back online.

The server accepts both. **Both sales happened** — there are two customers
holding two receipts and the shop has taken two lots of money. Stock goes to
−1, which is the truthful answer.

The server's job is to record this and make it visible: a negative-stock
exception appears in the app's own stock reports, and the shopkeeper decides
whether to refund, back-order or restock. The alternative — letting the server
"reject" the second sale — would mean the app had taken money for a sale the
books later deny, which is worse in every way.

Where the app is configured with `blockNegativeStock`, that guard runs on the
device at the point of sale, which is the only place it can run usefully. It is
not a server concern.

---

## 10. Infrastructure

A single VPS is enough to start and should be laid out so that growing past it
is not a rewrite.

```
Caddy (TLS, HTTP/2, gzip)
  └── API — Node 20 + Fastify, or Go if you prefer a single binary
        └── PgBouncer (transaction pooling)
              └── Postgres 16
Object storage (S3-compatible, a different provider)
  ├── snapshots
  ├── archived ops
  └── base backups + WAL
```

Non-negotiables:

- **Backups leave the box.** The entire premise is surviving the loss of a
  device; a backup on the same VPS does not survive the loss of the VPS. Use
  pgBackRest or WAL-G to object storage held by a *different* provider, and
  restore-test it on a schedule. An untested backup is a rumour.
- **TLS only**, HSTS, no plaintext port open.
- **Rate limits** on `/v1/auth/*` and `/v1/sync/push`, per account and per IP.
- **Migrations** run as a deploy step, forward-only, with the API tolerating one
  version of skew in both directions — devices in the field update when they
  update, not when you do.
- **Structured logs** with `business_id` and `device_id` on every line, and no
  payloads: the operation bodies contain customer names and phone numbers.

### Bandwidth

Shops on mobile data pay for every byte, and the app already exposes a
`wifiOnly` switch. Accordingly: gzip everything, default `pull` limit 500
operations, batch pushes, and never send a snapshot on a metered connection
without asking.

---

## 11. What the client still needs

This section was written before any of it existed. Most of it now does; kept
here as a record of what shipped and how it actually maps onto the design
above, since the two are meant to never drift apart:

1. **The operation log.** Not built the way originally sketched here (`commit()`
   taking an optional operation) — instead, individual mutators in `logic.ts`
   call a small `enqueue(d, kind, ref)` helper that appends `{ id, ts, kind,
   ref }` to `DB.queue`. The full envelope described in §4 is built lazily, at
   push time, by `opsFrom()` in `syncClient.ts`, which looks the record up by
   `ref` and wraps it with `buildOp()`. Net effect is the same — nothing can
   mutate without a queue entry — just assembled later than planned.
2. **`DB.queue` is the outbound buffer.** Done, as sketched.
3. **Applying pulled operations.** Done: `applyRemoteOps()` in
   `AppDataContext.tsx` is the reducer, one `if`/`else if` per operation kind,
   upserting into the matching collection and folding `stock.move` into
   `product.stock[branch]` as it applies each one.
4. **A real push.** Done via `pushQueue()` / `pullOps()` / `uploadSnapshot()`
   in `syncClient.ts`, orchestrated by `useSyncRun()`. Worth recording since it
   went wrong once: three places in the UI (`DataToolsScreen`'s "Send anything
   waiting", `OnlineScreen`'s "Sync now", and `toggleOnline()` on reconnect)
   were still calling an older `flushQueue()` that marked every sale `synced`
   and emptied the queue *without sending anything* — a leftover from before
   this existed. Fixed to call the real push; `flushQueue()` itself is gone.
5. **Folds after a pull.** Handled incrementally rather than by recomputing
   from scratch: `applyRemoteOps()` adds each pulled `stock.move`'s quantity
   onto the local `product.stock[branch]` as it goes, the same way a local
   sale already does, rather than trusting a stock number in the payload.
   Account and ledger balances were never stored as a number to begin with —
   `accountBalance()` sums journal lines on every call — so a pulled
   `journal.post` needs no special handling at all.
6. **Licence verification.** Done: the Ed25519 public key is embedded in
   `licenceKey.ts`, which verifies offline and rejects any token whose `alg`
   is not `EdDSA`. `Licence.status` and `offlineSince` drive the grace window
   exactly as planned.

What is not yet real: **document number leases (§8)**. The server side exists
— `POST /v1/sync/numbers/lease` is implemented in `server/src/sync.js` — but
nothing on the client calls it. `counters.sale` is still a local integer, so
two offline tills in one branch can still issue the same invoice number;
`numberSafe.mode` exists to fall back to a tagged number, but only once the
client is actually leasing blocks and can notice it has run out. And **field-
level conflict resolution** beyond last-write-wins is not attempted; a
rejected push is simply handed the current server row per §3.

---

## 12. Wire contract

The operation envelope, push/pull payloads and licence claims are defined as
TypeScript in [`src/data/syncProtocol.ts`](../src/data/syncProtocol.ts) so the
app and the server compile against the same file rather than against two
descriptions of it that drift.
