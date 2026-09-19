let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return prefix + '_' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}

export function iso(d?: Date): string {
  return (d || new Date()).toISOString();
}

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export function hoursAgo(n: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

export function mulberry(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
