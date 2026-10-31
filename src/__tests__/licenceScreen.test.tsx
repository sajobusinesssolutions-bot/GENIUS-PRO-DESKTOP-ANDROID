import React from 'react';
import { render, cleanup } from '@testing-library/react-native';
import { seed } from '../data/seed';
import { migrate } from '../data/storage';

let mockDb: any;
jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: mockDb, money: (n: number) => 'UGX ' + n, refreshLicence: jest.fn() }),
  useAppDataSafe: () => ({ db: mockDb }),
}));
jest.mock('../data/AuthContext', () => ({ useAuth: () => ({ account: null }), useAuthSafe: () => null }));
jest.mock('../nav/navigate', () => ({ useGo: () => jest.fn() }));

import { ToastProvider } from '../components/Toast';
import LicenceScreen from '../screens/LicenceScreen';

afterEach(cleanup);

describe('Plan & License draws for every edition and licence state', () => {
  for (const edition of ['retail', 'pharmacy', 'restaurant']) {
    for (const state of ['trial', 'paid', 'none']) {
      it(edition + ' · ' + state, () => {
        const d: any = migrate(seed());
        d.settings.edition = edition;
        d.firm.edition = edition;
        if (state === 'paid') d.licence = { ...d.licence, plan: 'pro', status: 'active', expiresAt: new Date(Date.now() + 30 * 864e5).toISOString() };
        if (state === 'none') d.licence = { ...d.licence, licence: undefined };
        mockDb = d;
        expect(() => render(<ToastProvider><LicenceScreen /></ToastProvider>)).not.toThrow();
      });
    }
  }
  // what the server sends: one licence for several editions, any plan it knows
  for (const lic of [
    { plan: 'pro', edition: 'retail,restaurant', status: 'active', expiresAt: new Date(Date.now() + 9e9).toISOString() },
    { plan: 'starter', edition: 'pharmacy', status: 'active', expiresAt: null },
    { plan: 'trial', edition: 'restaurant', status: 'trial', expiresAt: new Date(Date.now() + 9e8).toISOString() },
    { plan: 'lifetime', edition: 'retail', status: 'active', expiresAt: null, maxBusinesses: 5 },
    { plan: 'pro', edition: 'wholesale', status: 'active', expiresAt: null },
  ]) {
    it('server licence ' + lic.plan + ' · ' + lic.edition, () => {
      const d: any = migrate(seed());
      d.licence = { ...d.licence, licence: lic, state: 'active' };
      mockDb = d;
      expect(() => render(<ToastProvider><LicenceScreen /></ToastProvider>)).not.toThrow();
    });
  }
});
