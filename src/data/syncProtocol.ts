/**
 * THE WIRE CONTRACT between the app and the sync server.
 *
 * The design this implements is in docs/SYNC_BACKEND.md. This file is the part
 * of it that must not drift: both sides compile against these types, so a change
 * to the shape of an operation breaks the build rather than breaking a shop's
 * books six weeks later.
 *
 * Nothing here talks to a network. It is the vocabulary plus the few pure
 * functions that both sides need to agree on exactly — how an operation is
 * built, when a cursor has moved, whether a licence is still good.
 */
import { SCHEMA_VERSION } from './defaults';

/** The schema a payload written by this build carries. */
export const WIRE_SCHEMA = SCHEMA_VERSION;

/* ================================================================
   Identity
   ================================================================ */

/** The owner's email account. Licences hang off this. */
export type AccountId = string;
/** A tenant — one entry in the app's DB.firms[]. */
export type BusinessId = string;
/** A device seat. One phone or tablet. */
export type DeviceId = string;

/* ================================================================
   Operations
   ================================================================ */

/**
 * What happened. Named after the app's own mutators so there is no translation
 * layer between `logic.ts` and the log.
 *
 * A server that does not recognise a kind must still store it and hand it back
 * on pull. Understanding a sale is not a prerequisite for keeping it safe, and
 * an older server must never silently drop a newer app's work.
 */
export type OpKind =
  // sales
  | 'sale.commit' | 'sale.void' | 'sale.edit' | 'sale.delete'
  // buying
  | 'purchase.create' | 'purchase.void' | 'po.create' | 'po.receive'
  // money
  | 'payment.record' | 'entry.record' | 'transfer.record' | 'journal.post'
  // stock
  | 'stock.move' | 'stock.adjust' | 'stocktake.post' | 'production.run'
  // returns
  | 'creditnote.create'
  // till
  | 'shift.open' | 'shift.close'
  // branches
  | 'branch.open' | 'branch.update' | 'branch.disable'
  // last-write-wins records: products, parties, roles, settings, offers…
  | 'record.upsert'
  // housekeeping
  | 'audit.append';

/**
 * The kinds that are facts about something that happened. They are append-only
 * and therefore cannot conflict, which is why most of the sync is simple.
 */
export const FACT_KINDS: readonly OpKind[] = [
  'sale.commit', 'sale.void', 'sale.edit', 'sale.delete',
  'purchase.create', 'purchase.void', 'po.create', 'po.receive',
  'payment.record', 'entry.record', 'transfer.record', 'journal.post',
  'stock.move', 'stock.adjust', 'stocktake.post', 'production.run',
  'creditnote.create', 'shift.open', 'shift.close',
  'branch.open', 'branch.update', 'branch.disable', 'audit.append',
];

export function isFact(kind: OpKind): boolean {
  return FACT_KINDS.indexOf(kind) > -1;
}

/** A record that is edited in place, and so needs a revision to detect a clash. */
export interface UpsertPayload {
  coll: string;
  recId: string;
  /** The revision this edit was made against. Absent means "this is new". */
  baseRev?: number;
  doc: Record<string, unknown>;
}

export interface Op<P = unknown> {
  /** Generated on the device. The idempotency key — pushing twice is free. */
  opId: string;
  business: BusinessId;
  /** The app's own warehouse id, e.g. 'wh_a1b2c3'. */
  branch?: string;
  device: DeviceId;
  /** The local staff id, carried for attribution only. */
  user?: string;
  kind: OpKind;
  /** The device's clock. Information, never an ordering key — phones drift. */
  ts: string;
  /** Per-device counter, for causal order within a device and for tie-breaks. */
  lamport: number;
  /** The DB schema the payload was written at. */
  schema: number;
  payload: P;
}

/** An operation as the server hands it back, with its place in the order. */
export interface StoredOp<P = unknown> extends Op<P> {
  /** Per-business monotonic. This is what a cursor points at. */
  seq: number;
  receivedAt: string;
}

/* ================================================================
   Push and pull
   ================================================================ */

export interface PushRequest {
  ops: Op[];
}

export type RejectReason =
  /** The record was edited by someone else since this device last saw it. */
  | 'stale_rev'
  /** Written by an app newer than this server understands how to project. */
  | 'bad_schema'
  | 'unknown_branch'
  | 'unknown_business'
  | 'malformed'
  /** The device's seat was revoked. */
  | 'device_revoked';

export interface OpRejection {
  opId: string;
  reason: RejectReason;
  /** For 'stale_rev': what the server holds now, so the app can resolve. */
  current?: { rev: number; doc: Record<string, unknown> };
  note?: string;
}

export interface PushResponse {
  /** Operation ids the server has durably stored. Includes ones it already had. */
  accepted: string[];
  rejected: OpRejection[];
  /** The business's sequence after this push. */
  seq: number;
}

export interface PullResponse {
  ops: StoredOp[];
  /** The sequence of the last operation in `ops`; the app's next cursor. */
  seq: number;
  /** True when more is waiting — walk the cursor rather than asking for it all. */
  more: boolean;
}

export interface SyncState {
  seq: number;
  ops: number;
  lastPush: string | null;
  lastPull: string | null;
}

/* ================================================================
   Document numbers
   ================================================================ */

export interface NumberLeaseRequest {
  branch: string;
  kind: 'sale' | 'purchase' | 'estimate' | 'challan' | 'creditNote' | 'po' | 'plan';
  size: number;
}

/**
 * A block of numbers this device owns outright.
 *
 * Blocks never overlap, so two offline tills cannot issue the same number
 * without talking to each other or to the server at the moment of sale. Gaps
 * are expected — a device that leases a hundred and sells eleven leaves a hole —
 * so nothing may treat a gap as evidence of a missing document.
 */
export interface NumberLease {
  branch: string;
  kind: NumberLeaseRequest['kind'];
  lo: number;
  hi: number;
}

/* ================================================================
   Licensing
   ================================================================ */

/**
 * The claims inside the signed licence token (Ed25519, compact JWS).
 *
 * The app embeds the public key and verifies this offline, so a shop with no
 * connection keeps trading on the token it already holds. `exp` is short — about
 * thirty days — and refreshed on every sync, so revocation lands within a month
 * without the app ever needing to be online at a particular moment.
 */
export interface LicenceClaims {
  sub: AccountId;
  /** The owner's email. The licence follows this, not a device or a business. */
  email: string;
  /**
   * What the licence is right now, as the server sees it: active, trial,
   * expired, blocked or revoked. Carried in the token so a licence the server
   * has blocked stops a phone at its next check-in, not a month later when the
   * token itself runs out.
   */
  status?: string;
  /** When the subscription ends — null for a lifetime licence. */
  until?: string | null;
  plan: string;
  term: string;
  /** How many devices this account may register. */
  seats: number;
  features: string[];
  businesses: BusinessId[];
  iat: number;
  exp: number;
  jti: string;
}

/** How long a device may go unverified before the licence is treated as stale. */
export const LICENCE_GRACE_DAYS = 14;

/**
 * What the app should do with a licence right now.
 *
 * These are the values the app's own `LicStatus` already carries. The one rule
 * that governs all of them: **an expired licence never stops a shop selling.**
 * A till that locks because a card failed in another country is a till that ends
 * up in a drawer. Past grace the app goes read-only around the edges — reports,
 * exports, bulk editors, branch management — and keeps taking money.
 */
export type LicenceVerdict = 'active' | 'trial' | 'stale' | 'expired' | 'unbound';

export function licenceVerdict(
  claims: LicenceClaims | null,
  opts: { now?: Date; accountId?: AccountId; graceDays?: number } = {},
): LicenceVerdict {
  const now = opts.now || new Date();
  const grace = opts.graceDays ?? LICENCE_GRACE_DAYS;
  if (!claims) return 'expired';
  if (opts.accountId && claims.sub !== opts.accountId) return 'unbound';

  const expMs = claims.exp * 1000;
  const nowMs = now.getTime();
  if (nowMs <= expMs) return claims.plan === 'trial' ? 'trial' : 'active';
  // past expiry but inside the window a shop can plausibly be offline for
  if (nowMs <= expMs + grace * 86400000) return 'stale';
  return 'expired';
}

/** Whether the app may still ring up a sale. Answer: almost always yes. */
export function mayTrade(verdict: LicenceVerdict): boolean {
  return verdict !== 'unbound';
}

/** Whether the app may still write anything beyond a sale — reports, bulk edits. */
export function mayAdminister(verdict: LicenceVerdict): boolean {
  return verdict === 'active' || verdict === 'trial' || verdict === 'stale';
}

/* ================================================================
   Building operations
   ================================================================ */

export interface OpContext {
  business: BusinessId;
  device: DeviceId;
  branch?: string;
  user?: string;
  schema: number;
  /** Per-device, strictly increasing. Persisted, so it survives a restart. */
  lamport: number;
  newId: () => string;
  now?: () => Date;
}

/**
 * Builds one operation.
 *
 * The id is generated here rather than by the server precisely so that a push
 * that times out can be retried without the device having to know whether the
 * first attempt landed — which, on the connections this app is built for, it
 * frequently cannot.
 */
export function buildOp<P>(ctx: OpContext, kind: OpKind, payload: P): Op<P> {
  const now = (ctx.now || (() => new Date()))();
  return {
    opId: ctx.newId(),
    business: ctx.business,
    branch: ctx.branch,
    device: ctx.device,
    user: ctx.user,
    kind,
    ts: now.toISOString(),
    lamport: ctx.lamport,
    schema: ctx.schema,
    payload,
  };
}

/**
 * The order operations must be applied in.
 *
 * `seq` is the server's per-business total order and is authoritative. Anything
 * not yet pushed has no seq, so it sorts after everything that has, by the
 * device's own counter. Wall-clock time is deliberately not used: two phones
 * minutes out of step would otherwise interleave each other's work.
 */
export function opOrder(a: Partial<StoredOp>, b: Partial<StoredOp>): number {
  const as = a.seq ?? Number.MAX_SAFE_INTEGER;
  const bs = b.seq ?? Number.MAX_SAFE_INTEGER;
  if (as !== bs) return as - bs;
  const al = a.lamport ?? 0;
  const bl = b.lamport ?? 0;
  if (al !== bl) return al - bl;
  return String(a.opId || '').localeCompare(String(b.opId || ''));
}

/**
 * The cursor to store after applying a batch.
 *
 * It only ever moves forward. A pull that returns nothing, or that somehow
 * returns something older than what has already been applied, must not rewind
 * the cursor and cause the same work to be replayed.
 */
export function nextCursor(current: number, batch: { seq: number }[]): number {
  return batch.reduce((max, o) => (o.seq > max ? o.seq : max), current);
}

/**
 * Which of this device's operations still need pushing.
 *
 * Anything the server has acknowledged is dropped by id, not by position, since
 * a push may be acknowledged out of order or in part.
 */
export function stillPending(queue: Op[], accepted: string[]): Op[] {
  const done = new Set(accepted);
  return queue.filter((o) => !done.has(o.opId));
}
