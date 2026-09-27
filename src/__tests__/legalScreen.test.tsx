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

  it('is in the menu for everyone, findable by search, and needs no permission', () => {
    const g = MENU_GROUPS.find((x) => x.id === 'legal');
    expect(g?.perm).toBeNull();
    expect(g?.items.map((i) => i.n)).toEqual(['Privacy policy', 'Terms and conditions']);
    expect(searchMenu('privacy').some((h) => h.item.route === 'Legal')).toBe(true);
    expect(ROUTE_PERMS.Legal).toBeNull();
  });
});
