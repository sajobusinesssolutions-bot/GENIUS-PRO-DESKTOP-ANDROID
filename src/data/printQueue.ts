/**
 * One print at a time through the phone's print system. Android refuses a
 * second print while the first one's dialog is still open ("Another print
 * request is already in progress") — an automatic receipt followed by a tap
 * on Print, or the next sale's receipt, failed that way. Each print now waits
 * for the one before it to finish.
 */
import * as Print from 'expo-print';

let line: Promise<unknown> = Promise.resolve();

export function systemPrint(opts: Print.PrintOptions): Promise<void> {
  const run = line.catch(() => undefined).then(async () => {
    try {
      await Print.printAsync(opts);
    } catch (e: any) {
      // the system's own dialog was still closing: one more try once it has
      if (!/already in progress/i.test(String(e?.message || e))) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      await Print.printAsync(opts);
    }
  });
  line = run;
  return run;
}
