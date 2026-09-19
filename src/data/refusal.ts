/**
 * A refusal the person should read, rather than a failure.
 *
 * "The licence has run out", "No connection", "Your role cannot adjust stock":
 * these stop something being written, and they must reach the person with the
 * reason. They are thrown from deep inside the actions that write, and most of
 * the buttons calling those actions do not catch anything — so a refusal used
 * to surface as a crash on every screen except the two that happened to wrap
 * their call. The handler below catches any Refusal that nothing else caught
 * and shows it, and nothing after the throw runs, so nothing is written.
 */
import { Alert } from 'react-native';

export class Refusal extends Error {
  readonly title: string;
  readonly why: string;
  constructor(title: string, why: string) {
    // the message keeps the old one-line form for callers that show e.message
    super(title + ' — ' + why);
    this.name = 'Refusal';
    this.title = title;
    this.why = why;
  }
}

let installed = false;

/** Shows any uncaught Refusal instead of letting it crash the app. Idempotent. */
export function installRefusalHandler() {
  if (installed) return;
  const EU = (global as any).ErrorUtils;
  if (!EU || typeof EU.getGlobalHandler !== 'function') return;
  installed = true;
  const previous = EU.getGlobalHandler();
  EU.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    if (error instanceof Refusal || (error as any)?.name === 'Refusal') {
      const r = error as Refusal;
      Alert.alert(r.title || 'Not allowed', r.why || r.message);
      return;
    }
    previous(error, isFatal);
  });
}
