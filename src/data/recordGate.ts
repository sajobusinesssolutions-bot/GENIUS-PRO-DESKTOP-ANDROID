/**
 * MAY THIS TRANSACTION BE SAVED?
 *
 * Two rules stand between a person pressing the button and a record being
 * written, and both must say *why* when they refuse. A till that fails silently,
 * or that fails with "error", is worse than one that does not work at all —
 * the operator has a customer in front of them and needs to know whether to
 * take the money.
 *
 * 1. **The licence.** When it has run out, no new transaction is recorded. The
 *    books stay readable and a backup can still be taken, so nothing is held
 *    hostage, but nothing new is written.
 *
 * 2. **Sync.** When the owner has switched sync on, the shop has chosen to keep
 *    one set of books across its devices. Saving while offline would build a
 *    private pile of records on one phone that the other tills cannot see, which
 *    is the thing switching sync on was meant to prevent. So with sync on, a
 *    save needs a connection.
 *
 * The messages here are the ones an operator reads, so they say what happened,
 * why, and what to do next — in that order.
 */
import type { DB } from './types';
import { licState } from './logic';

export type RefusalCode = 'licence' | 'offline';

export interface Refusal {
  code: RefusalCode;
  /** One line, shown as the headline of the block. */
  title: string;
  /** What happened and what to do about it. */
  why: string;
  /** Where the person is sent to fix it. */
  route?: string;
  action?: string;
}

/** Why a licence in this state stops new records being written. */
const LICENCE_WHY: Record<string, { title: string; why: string }> = {
  expired: {
    title: 'The licence has run out',
    why: 'No new sale, purchase or payment can be recorded until it is renewed. '
      + 'Everything already in the books can still be read, printed and backed up.',
  },
  stale: {
    title: 'The licence needs checking',
    why: 'This device has not been able to confirm the licence for too long. '
      + 'Connect it to the internet once and it will carry on.',
  },
  blocked: {
    title: 'The licence is blocked',
    why: 'Recording is stopped on this account. Contact whoever manages your licence.',
  },
  revoked: {
    title: 'The licence was withdrawn',
    why: 'This licence is no longer valid. Recording is stopped until a new one is entered.',
  },
  toomany: {
    title: 'Too many devices on this licence',
    why: 'This licence covers fewer devices than are using it. Remove one, or add seats, then try again.',
  },
  invalid: {
    title: 'The licence is not valid',
    why: 'The licence on this device could not be read. Enter it again.',
  },
  unbound: {
    title: 'The licence belongs to another account',
    why: 'This licence was issued to a different owner, so it cannot unlock these books.',
  },
  unknown: {
    title: 'The licence could not be checked',
    why: 'The licence server gave no answer. Connect to the internet and try once more.',
  },
  none: {
    title: 'No licence on this device',
    why: 'Enter a licence to start recording.',
  },
};

/**
 * The states that stop recording.
 *
 * 'none' is deliberately not one of them. It means the device has never heard
 * from the licence server — a phone that has just been set up, or one that was
 * signed up before it could reach the internet — not that a licence ran out.
 * Blocking on it told every brand-new shop to 'enter a licence' while the server
 * had already given it a trial. The rule the owner asked for is that an
 * *expired* licence blocks, and it still does.
 */
const RECORDING_STATES = Object.keys(LICENCE_WHY).filter((k) => k !== 'none');

/**
 * Whether a new transaction may be written, and if not, why not.
 *
 * `online` is passed in rather than read off the book because the book only
 * holds the last thing the app was told; the caller has the live answer from
 * the network layer.
 */
export function mayRecord(d: DB, online: boolean, now = new Date()): Refusal | null {
  const state = licState(d, now);
  if (state !== 'active' && state !== 'trial' && RECORDING_STATES.indexOf(state) > -1) {
    const w = LICENCE_WHY[state];
    return { code: 'licence', title: w.title, why: w.why, route: 'Licence', action: 'Open licence' };
  }

  if (d.sync?.on && !online) {
    return {
      code: 'offline',
      title: 'No connection',
      why: 'Sync is switched on, so every sale is saved to your account as it is made and '
        + 'all your tills stay in step. This phone has no internet right now, so the sale '
        + 'cannot be saved yet. Reconnect and try again, or ask the owner to switch sync off '
        + 'to go back to working on this device alone.',
      route: 'Sync',
      action: 'Open sync settings',
    };
  }

  return null;
}

/** The same question, answered as a plain boolean. */
export function canRecord(d: DB, online: boolean, now = new Date()): boolean {
  return mayRecord(d, online, now) === null;
}

/**
 * The single line a thrown error carries.
 *
 * The posting functions in `logic.ts` throw, and the screens already show a
 * thrown message in an alert over the open sheet, so a refusal arrives in front
 * of the operator rather than behind whatever they were doing.
 */
export function refusalMessage(r: Refusal): string {
  return r.title + ' — ' + r.why;
}
