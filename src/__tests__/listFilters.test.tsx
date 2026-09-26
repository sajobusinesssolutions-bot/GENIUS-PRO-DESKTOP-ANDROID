import React from 'react';
import { render, screen } from '@testing-library/react-native';

const mockDb: any = { settings: { theme: 'light' } };
jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: mockDb }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

import { ListFilters } from '../components/ListFilters';

describe('ListFilters', () => {
  it('shows a compact filter and date button instead of a suggestion-heavy row', () => {
    render(
      <ListFilters
        filterLabel="Transaction"
        filterValue="all"
        filterOptions={[{ v: 'all', l: 'All rows' }, { v: 'sale', l: 'Sales' }]}
        onFilterChange={jest.fn()}
        from="2026-01-01"
        to="2026-01-31"
        onDateChange={jest.fn()}
      />,
    );

    expect(screen.getByText('Transaction')).toBeTruthy();
    expect(screen.getByText('Date')).toBeTruthy();
    expect(screen.getByText('All rows')).toBeTruthy();
    expect(screen.getByText('2026-01-01 - 2026-01-31')).toBeTruthy();
  });
});
