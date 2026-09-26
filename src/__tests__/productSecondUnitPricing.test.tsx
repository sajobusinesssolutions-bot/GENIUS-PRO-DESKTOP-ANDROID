/**
 * The second-unit price on the Pricing tab must divide the main price down,
 * never multiply it up: LineEditSheet.tsx's unitsFor() — what actually runs
 * at the till — treats `unit`/`price` as the item's own selling unit and
 * `secondaryUnit` as a smaller breakdown of it (a piece off a carton), and
 * falls back to `price / conversionRate` when no explicit secondary price is
 * set. A screen that suggested `price * conversionRate` instead would show
 * a sensible-looking number while quietly setting up a carton to sell for a
 * fraction of a single piece the moment nobody typed an override.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

const mockDb: any = {
  settings: { theme: 'light', taxRate: 18, trackBatches: false },
  session: { role: 'owner' },
  products: [],
  categories: ['General'],
  units: ['PC', 'CTN'],
  warehouses: [{ id: 'w1', name: 'Main store' }],
  users: [],
};

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({
    db: mockDb,
    product: () => undefined,
    updateProduct: jest.fn(),
    addProduct: jest.fn(),
    money: (n: number) => 'Sh ' + Math.round(n),
    can: () => true,
    addUnit: jest.fn(),
    addCategory: jest.fn(),
  }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

import { ToastProvider } from '../components/Toast';
import ProductDetailScreen from '../screens/ProductDetailScreen';

const nav: any = { goBack: jest.fn() };
const renderIt = () => render(
  <ToastProvider>
    <ProductDetailScreen navigation={nav} route={{ key: 'k', name: 'ProductDetail', params: {} } as any} />
  </ToastProvider>,
);

describe('the second unit\'s suggested price', () => {
  it('divides the main price down for the second unit, rather than multiplying it up', () => {
    renderIt();
    fireEvent.press(screen.getByText('Price'));
    // Cost price and Sale price share the placeholder "0" — Sale price is the second
    fireEvent.changeText(screen.getAllByPlaceholderText('0')[1], '2400');
    fireEvent.press(screen.getByText('— none —'));
    fireEvent.press(screen.getByText('CTN'));
    fireEvent.changeText(screen.getByPlaceholderText('A number, such as 24'), '24');

    // 2400 / 24 = 100, not 2400 * 24 = 57600
    expect(screen.getByText(/Sh 100 each/)).toBeTruthy();
    expect(screen.queryByText(/57,?600/)).toBeNull();
  });
});
