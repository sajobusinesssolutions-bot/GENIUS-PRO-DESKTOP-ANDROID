/**
 * The app's version, and the books' version.
 *
 * Each set of books records the newest app version that has opened it
 * (firm.minAppVersion), and that travels to the other phones with the business
 * details. An app older than that must not keep writing to the books — it
 * would not know what the newer version changed — so it stops at an "Update
 * required" screen until it is updated.
 */
import Constants from 'expo-constants';

export const APP_VERSION: string = Constants.expoConfig?.version || '0.0.0';

/** -1, 0 or 1, comparing "1.10.2" style versions part by part. */
export function compareVersions(a?: string | null, b?: string | null): number {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Whether these books need a newer app than this one. */
export function needsNewerApp(d: { firm?: { minAppVersion?: string } } | null | undefined, version = APP_VERSION): boolean {
  return compareVersions(d?.firm?.minAppVersion, version) > 0;
}
