/**
 * The bug these cover: a sheet only scrolled where a touch happened to miss
 * something. The body had been wrapped in a Pressable for tap-to-dismiss, and
 * that Pressable competed with the ScrollView for the pan gesture. The scrim
 * now sits behind the sheet instead of around it.
 *
 * The other one: the primary action sat at the end of a long scroll, so on a
 * full cart there appeared to be no way to finish. It belongs in the pinned
 * footer, which is outside the scrolling body.
 */
import React from 'react';
import { Text, ScrollView } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

const mockDb: any = { settings: { theme: 'light' } };
jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: mockDb }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

import { Sheet } from '../components/Sheet';

function setup(onClose = jest.fn()) {
  const utils = render(
    <Sheet visible title="Review and save" onClose={onClose} footer={<Text>Complete sale</Text>}>
      <Text>a line in the cart</Text>
    </Sheet>,
  );
  return { ...utils, onClose };
}

/** Walks up from a node collecting component types, so structure can be asserted. */
function ancestors(node: any): any[] {
  const out: any[] = [];
  let n = node?.parent;
  while (n) { out.push(n); n = n.parent; }
  return out;
}

describe('Sheet', () => {
  it('shows its title, body and footer', () => {
    setup();
    expect(screen.getByText('Review and save')).toBeTruthy();
    expect(screen.getByText('a line in the cart')).toBeTruthy();
    expect(screen.getByText('Complete sale')).toBeTruthy();
  });

  it('scrolls its body', () => {
    setup();
    expect(screen.UNSAFE_getAllByType(ScrollView).length).toBeGreaterThan(0);
  });

  it('does not wrap the scrolling body in the scrim, which stole the drag', () => {
    setup();
    const scrim = screen.getByTestId('sheet-scrim');
    const body = screen.getByText('a line in the cart');
    // the scrim must be a sibling behind the sheet, never an ancestor of the list
    expect(ancestors(body)).not.toContain(scrim);
  });

  it('keeps the primary action out of the scroll, so it cannot be scrolled past', () => {
    setup();
    const action = screen.getByText('Complete sale');
    expect(ancestors(action).some((n) => n.type === ScrollView)).toBe(false);
  });

  it('closes when the scrim behind it is tapped', () => {
    const onClose = jest.fn();
    setup(onClose);
    fireEvent.press(screen.getByTestId('sheet-scrim'));
    expect(onClose).toHaveBeenCalled();
  });
});
