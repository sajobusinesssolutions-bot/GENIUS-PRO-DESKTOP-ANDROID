/**
 * What a trial gets, and what happens when it ends: seven days of everything
 * but sync, then nothing new until a plan is chosen — with the books still
 * open to read.
 */
import { access, mayCreate, licFeature, TRIAL_DAYS } from '../logic';
import { mayRecord, planRefusal } from '../recordGate';
import { defaultSubscription } from '../defaults';

const day = 864e5;
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();

function withLicence(plan: string, endsInDays: number | null, status = plan === 'trial' ? 'trial' : 'active'): any {
  return {
    licence: {
      key: 'jti', status, checkedAt: new Date().toISOString(), server: '', reason: '', offlineSince: '',
      licence: {
        no: 'jti', plan, planName: plan, term: 'days', expiresAt: endsInDays === null ? '' : at(endsInDays),
        daysLeft: endsInDays, devices: 1, limits: { devices: 1 }, features: plan === 'trial' ? [] : ['sync'],
      },
    },
    subscription: defaultSubscription(),
    sync: { on: false },
  };
}

it('the trial is seven days', () => {
  expect(TRIAL_DAYS).toBe(7);
  const s = defaultSubscription();
  expect(Math.round((new Date(s.trialUntil).getTime() - Date.now()) / day)).toBe(7);
});

describe('during the trial', () => {
  const d = withLicence('trial', 3);
  it('everything new may be made', () => {
    expect(access(d)).toBe('trial');
    expect(mayCreate(d)).toBe(true);
    expect(mayRecord(d, true)).toBeNull();
  });
  it('but there is no sync, even if an old token offered it', () => {
    d.licence.licence.features = ['sync'];
    expect(licFeature(d, 'sync')).toBe(false);
  });
});

describe('once the trial has ended', () => {
  const d = withLicence('trial', -1);
  it('nothing new may be made, and it says why and where to go', () => {
    expect(access(d)).toBe('trialOver');
    expect(mayCreate(d)).toBe(false);
    const r = planRefusal(d)!;
    expect(r.title).toBe('Your free trial has ended');
    expect(r.why).toMatch(/can still be read, printed, exported and backed up/);
    expect(r.route).toBe('Licence');
    expect(mayRecord(d, true)!.title).toBe('Your free trial has ended');
  });
  it('the same holds for the local trial on a phone that never reached the server', () => {
    const local: any = { licence: { key: '' }, subscription: { ...defaultSubscription(), trialUntil: at(-2) }, sync: { on: false } };
    expect(access(local)).toBe('trialOver');
    expect(planRefusal(local)).not.toBeNull();
  });
});

describe('a paid plan', () => {
  it('opens everything, sync included', () => {
    const d = withLicence('pro', 40);
    expect(access(d)).toBe('paid');
    expect(mayCreate(d)).toBe(true);
    expect(licFeature(d, 'sync')).toBe(true);
  });
  it('lifetime never runs out', () => {
    expect(access(withLicence('pro', null))).toBe('paid');
  });
  it('once past its end date stops new records and sync, even while the last answer still said active', () => {
    const d = withLicence('starter', -1);
    expect(access(d)).toBe('lapsed');
    expect(planRefusal(d)!.title).toBe('Your plan has run out');
    expect(licFeature(d, 'sync')).toBe(false);
  });
});
