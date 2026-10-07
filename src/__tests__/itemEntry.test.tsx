/**
 * Adding an item: typing the name lists saved items, a tap picks one, and the
 * line saves with what was typed. Low stock reads as "Low".
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: { settings: { theme: 'light' } } }),
  useAppDataSafe: () => ({ db: { settings: { theme: 'light' } } }),
}));

import ItemEntrySheet from '../components/ItemEntrySheet';
import type { Product } from '../data/types';

const item = (id: string, name: string, stock: number, extra: Partial<Product> = {}): Product => ({
  id, sku: id, name, unit: 'Pcs', category: 'General', cost: 50, price: 100, taxRate: 0,
  stock: { main: stock }, reorder: 2, warrantyMonths: 0, active: true, ...extra,
});
const products = [item('a', 'NVR TIANDY', 1), item('b', 'NVR STAND', 9), item('c', 'PHONE X', 3, { trackSerials: true })];

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function open(onSave = jest.fn()) {
  render(
    <ItemEntrySheet
      visible title="Add Items to Sale" products={products} money={(n) => 'Sh ' + n}
      stockOf={(p) => p.stock.main} priceOf={(p) => p.price}
      trackImei trackBatches onSave={onSave} onClose={jest.fn()}
    />,
  );
  act(() => { jest.runAllTimers(); });
  const name = screen.getByPlaceholderText('e.g. Sugar 1 kg');
  fireEvent(name, 'focus');
  fireEvent.changeText(name, 'nvr');
  return onSave;
}

it('lists matches with only the name and stock, flags low stock, and saves a picked item', () => {
  const onSave = open();
  expect(screen.getByText('NVR TIANDY')).toBeTruthy();
  expect(screen.getByText('Pcs · low')).toBeTruthy();
  expect(screen.queryByText('a')).toBeNull();

  fireEvent.press(screen.getByText('NVR STAND'));
  act(() => { jest.runAllTimers(); });
  fireEvent.changeText(screen.getAllByDisplayValue('')[0], '2');
  fireEvent.press(screen.getByText('Save'));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ qty: 2, price: 100 }), false);
});

it('opens the IMEI entry outside the item screen when a phone is saved without IMEIs', () => {
  render(
    <ItemEntrySheet
      visible title="Add Items to Sale" products={products} money={(n) => 'Sh ' + n}
      stockOf={(p) => p.stock.main} priceOf={(p) => p.price} startProduct={products[2]}
      trackImei onSave={jest.fn()} onClose={jest.fn()}
    />,
  );
  act(() => { jest.runAllTimers(); });
  fireEvent.press(screen.getByText('Select IMEI / Serial No.'));
  expect(screen.getByText('IMEI · PHONE X')).toBeTruthy();
});
