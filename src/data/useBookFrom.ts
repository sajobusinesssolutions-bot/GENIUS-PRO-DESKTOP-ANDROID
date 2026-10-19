/**
 * The book a screen needs for a date range starting at `fromMs`.
 *
 * With the whole book in memory (the window switched off) this is simply the
 * live book, at no cost. With only recent trade in memory, a range that starts
 * earlier gets a separate book read from disk from that day on, with
 * everything before it brought forward (storage.ts bookForRange) — exact, and
 * only as large as the range. Until it has arrived the hook returns `null`, so
 * a screen shows "reading" rather than a figure taken from the wrong book.
 *
 * `fromMs` of 0 means "from the very beginning".
 */
import { useEffect, useState } from 'react';
import { bookForRange, needsOlder } from './storage';
import type { DB } from './types';

export function useBookFrom(live: DB | null, fromMs: number): { book: DB | null; reading: boolean; failed: boolean } {
  const need = needsOlder(live, fromMs);
  const [got, setGot] = useState<{ from: number; book: DB } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!live || !need) { setGot(null); setFailed(false); return undefined; }
    let alive = true;
    setFailed(false);
    bookForRange(live, fromMs)
      .then((b) => { if (alive) setGot({ from: fromMs, book: b }); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [live, need, fromMs]);
  if (!need) return { book: live, reading: false, failed: false };
  const book = got && got.from === fromMs ? got.book : null;
  return { book, reading: !book && !failed, failed };
}
