/**
 * The bug these cover: a sale was refused for insufficient stock and the
 * message never reached the operator. Sheets in this app are Modals, and on
 * Android a Modal draws above everything else in the same tree, so a banner
 * rendered as a plain overlay sat behind the open checkout sheet. A Modal of
 * its own fixed that but took every touch on the screen until it faded. Now the
 * stack is a plain overlay that lets touches through, and a sheet carries a
 * ToastHost that draws the stack inside it while it is open.
 */
import React from 'react';
import { Text, Pressable, Modal } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

const mockDb: any = { settings: { theme: 'light' } };
jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: mockDb }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

import { ToastProvider, ToastHost, useToast } from '../components/Toast';

const MESSAGE = 'Not enough Widget A — 2 PC on hand, 5 needed';

function Thrower() {
  const { error, success } = useToast();
  return (
    <>
      <Pressable onPress={() => error(MESSAGE)}><Text>refuse</Text></Pressable>
      <Pressable onPress={() => success('Saved')}><Text>ok</Text></Pressable>
    </>
  );
}

/** Stands in for an open checkout sheet, which is a Modal. */
function OpenSheet() {
  return <Modal visible><Text>Review and save</Text><ToastHost /></Modal>;
}

function setup(withSheet = false) {
  return render(
    <ToastProvider>
      <Thrower />
      {withSheet ? <OpenSheet /> : null}
    </ToastProvider>,
  );
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('the toast stack', () => {
  it('shows nothing until something goes wrong', () => {
    setup();
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('puts the refusal on screen in full, so it can be acted on', () => {
    setup();
    fireEvent.press(screen.getByText('refuse'));
    expect(screen.getByText(MESSAGE)).toBeTruthy();
  });

  it('still shows it while a sheet is open — the case that was missed', () => {
    setup(true);
    fireEvent.press(screen.getByText('refuse'));
    expect(screen.getByText('Review and save')).toBeTruthy();
    expect(screen.getByText(MESSAGE)).toBeTruthy();
  });

  it('is drawn inside the open sheet, so it shows above it', () => {
    setup(true);
    fireEvent.press(screen.getByText('refuse'));
    let node: any = screen.getByText(MESSAGE).parent;
    let inModal = false;
    while (node) {
      if (node.type === 'Modal' || node.type?.displayName === 'Modal') { inModal = true; break; }
      node = node.parent;
    }
    expect(inModal).toBe(true);
    expect(screen.getAllByText(MESSAGE)).toHaveLength(1);
  });

  it('never sits in a Modal of its own, which would block every tap until it faded', () => {
    setup();
    fireEvent.press(screen.getByText('refuse'));
    let node: any = screen.getByText(MESSAGE).parent;
    while (node) {
      expect(node.type === 'Modal' || node.type?.displayName === 'Modal').toBe(false);
      node = node.parent;
    }
  });

  it('leaves the screen underneath tappable while it is showing', () => {
    setup();
    fireEvent.press(screen.getByText('refuse'));
    fireEvent.press(screen.getByText('ok'));
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('holds an error long enough to be read, unlike a confirmation', () => {
    setup();
    fireEvent.press(screen.getByText('ok'));
    fireEvent.press(screen.getByText('refuse'));

    act(() => { jest.advanceTimersByTime(3500); });
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByText(MESSAGE)).toBeTruthy();

    act(() => { jest.advanceTimersByTime(3000); });
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('goes away when the operator taps it', () => {
    setup();
    fireEvent.press(screen.getByText('refuse'));
    fireEvent.press(screen.getByText(MESSAGE));
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });
});
