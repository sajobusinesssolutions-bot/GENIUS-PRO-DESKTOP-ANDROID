import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

const mockDb: any = { settings: { theme: 'light' } };
const mockGo = jest.fn();
jest.mock('../data/AppDataContext', () => ({ useAppData: () => ({ db: mockDb }), useAppDataSafe: () => ({ db: mockDb }) }));
jest.mock('../nav/navigate', () => ({ useGo: () => mockGo }));

import LegalScreen from '../screens/LegalScreen';
import { MENU_GROUPS, searchMenu } from '../data/menuGroups';
import { ROUTE_PERMS } from '../nav/routePerms';

const at = (doc?: 'privacy' | 'terms') => render(<LegalScreen navigation={{} as any} route={{ key: 'l', name: 'Legal', params: doc ? { doc } : undefined } as any} />);

describe('Legal', () => {
  it('lists both documents and opens each', () => {
    at();
    fireEvent.press(screen.getByText('Privacy policy'));
    expect(mockGo).toHaveBeenCalledWith('Legal', { doc: 'privacy' });
    fireEvent.press(screen.getByText('Terms and conditions'));
    expect(mockGo).toHaveBeenCalledWith('Legal', { doc: 'terms' });
  });

  it('shows the privacy policy', () => {
    at('privacy');
    expect(screen.getByText('1. Who we are')).toBeTruthy();
    expect(screen.getByText(/no advertising and no third-party analytics/)).toBeTruthy();
  });

  it('shows the terms', () => {
    at('terms');
    expect(screen.getByText('1. Agreement')).toBeTruthy();
  });

  it('sits in Help & about, open to everyone and findable by search', () => {
    const g = MENU_GROUPS.find((x) => x.id === 'help');
    expect(g?.perm).toBeNull();
    expect(g?.open).toBe('Help');
    const names = g?.items.map((i) => i.n);
    for (const n of ['Privacy policy', 'Terms and conditions', 'App & updates', 'Plan & licence', 'Share the app',
      'Email support', 'WhatsApp support', 'Feature request', 'FAQs & help']) expect(names).toContain(n);
    expect(searchMenu('privacy').some((h) => h.item.route === 'Legal')).toBe(true);
    expect(searchMenu('faq').some((h) => h.item.route === 'Faq')).toBe(true);
    expect(ROUTE_PERMS.Legal).toBeNull();
    expect(ROUTE_PERMS.Help).toBeNull();
    expect(ROUTE_PERMS.Faq).toBeNull();
  });

  it('App & updates and Plan & licence are no longer duplicated under Settings', () => {
    const admin = MENU_GROUPS.find((x) => x.id === 'admin');
    expect(admin?.items.some((i) => i.route === 'About' || i.route === 'Plans')).toBe(false);
  });
});
