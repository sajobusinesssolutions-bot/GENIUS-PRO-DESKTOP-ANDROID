/**
 * The quantity on a bill starts empty — the cashier types it — unless the item
 * is set to fill it in, when it starts at the item's number.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: { settings: { theme: 'light' } } }),
  useAppDataSafe: () => ({ db: { settings: { theme: 'light' } } }),
}));

import QtyPicker from '../components/QtyPicker';

const money = (n: number) => 'Sh ' + n;
const renderIt = (start?: string) => {
  const onConfirm = jest.fn();
  render(<QtyPicker visible productName="Nails 1kg" price={6000} maxStock={50} money={money} onConfirm={onConfirm} onCancel={jest.fn()} start={start} />);
  return onConfirm;
};

it('starts empty and will not add nothing', () => {
  const onConfirm = renderIt();
  expect(screen.getByDisplayValue('')).toBeTruthy();
  fireEvent.press(screen.getByText('Add'));
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('3'));
  fireEvent.press(screen.getByText('Add'));
  expect(onConfirm).toHaveBeenCalledWith(3);
});

it('starts at the item\'s own number when it is set to fill it in', () => {
  const onConfirm = renderIt('1');
  expect(screen.getByDisplayValue('1')).toBeTruthy();
  fireEvent.press(screen.getByText('Add'));
  expect(onConfirm).toHaveBeenCalledWith(1);
});
