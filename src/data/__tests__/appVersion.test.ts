import { compareVersions, needsNewerApp } from '../appVersion';

describe('app and books versions', () => {
  it('compares versions part by part, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2.0', '1.2')).toBe(0);
    expect(compareVersions('1.2.0', '1.3.0')).toBe(-1);
    expect(compareVersions(undefined, '1.0.0')).toBe(-1);
  });

  it('stops an older app at books a newer one has opened, and lets the same or newer through', () => {
    expect(needsNewerApp({ firm: { minAppVersion: '1.3.0' } }, '1.2.0')).toBe(true);
    expect(needsNewerApp({ firm: { minAppVersion: '1.2.0' } }, '1.2.0')).toBe(false);
    expect(needsNewerApp({ firm: { minAppVersion: '1.1.0' } }, '1.2.0')).toBe(false);
    expect(needsNewerApp({ firm: {} }, '1.2.0')).toBe(false);
  });
});
