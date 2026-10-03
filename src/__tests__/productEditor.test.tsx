/**
 * The item editor: labels live inside the boxes, a category is picked from a
 * list you can add to, the barcode box scans or makes a code, a product is
 * always counted, and its opening stock is one figure for this branch.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { TextInput } from 'react-native';

const mockAdd = jest.fn();
const mockAddCategory = jest.fn();
const mockDb: any = {
  settings: { theme: 'light', taxRate: 18, trackBatches: false },
  session: { role: 'owner', warehouse: 'w2' },
  products: [],
  categories: [],
  units: ['PC', 'CTN'],
  warehouses: [{ id: 'w1', name: 'Main shop' }, { id: 'w2', name: 'Town branch' }],
  users: [],
};

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({
    db: mockDb,
    product: () => undefined,
    updateProduct: jest.fn(),
    addProduct: mockAdd,
    money: (n: number) => 'Sh ' + Math.round(n),
    can: () => true,
    addUnit: jest.fn(),
    addCategory: mockAddCategory,
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

beforeEach(() => { mockAdd.mockReset(); mockAddCategory.mockReset(); });

/** Every text box on screen. Labels are drawn over the boxes rather than as placeholders, so boxes are found in order. */
const inputs = () => screen.UNSAFE_root.findAll((n: any) => n.type === TextInput);

it('starts with no category chosen, and makes one from the always-there New category row', () => {
  renderIt();
  // nothing chosen: the box shows only its name
  expect(screen.getAllByText('Category').length).toBeGreaterThan(0);
  fireEvent.press(screen.getByLabelText('Category'));
  expect(screen.getByText(/None yet/)).toBeTruthy();
  fireEvent.press(screen.getByText('＋ New category'));
  // the new-name box opens focused, labelled 'Name of the category'
  expect(screen.getByText('Name of the category')).toBeTruthy();
  fireEvent.changeText(inputs().find((n: any) => n.props.autoFocus)!, 'Phones');
  fireEvent.press(screen.getByText('Add'));
  expect(mockAddCategory).toHaveBeenCalledWith('Phones');
  expect(screen.getByText('Phones')).toBeTruthy();
});

it('saves the description, a made barcode, and the opening stock into this branch only', () => {
  renderIt();
  // the Name box's input is the first text input on the screen
  fireEvent.changeText(inputs()[0], 'Samsung A15');
  fireEvent.changeText(screen.getByPlaceholderText('Condition, specifications, colour, size…'), 'Used, 128 GB, black');
  fireEvent.press(screen.getByLabelText('Create a barcode'));
  fireEvent.press(screen.getByText('Stock'));
  expect(screen.queryByText('Keep count of this item')).toBeNull();
  fireEvent.changeText(screen.getByPlaceholderText('0'), '5');
  fireEvent.press(screen.getByText('Create item'));
  const saved = mockAdd.mock.calls[0][0];
  expect(saved.description).toBe('Used, 128 GB, black');
  expect(saved.barcodes).toHaveLength(1);
  expect(saved.barcodes[0]).toMatch(/^62\d{11}$/);
  expect(saved.trackInventory).toBe(true);
  expect(saved.stock).toEqual({ w1: 0, w2: 5 });
});

it('has no markup chips on the price tab', () => {
  renderIt();
  fireEvent.press(screen.getByText('Price'));
  expect(screen.queryByText('25%')).toBeNull();
  expect(screen.queryByText(/Sell the same item two ways/)).toBeNull();
});
