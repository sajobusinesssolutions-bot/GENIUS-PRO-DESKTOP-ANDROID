/**
 * Fields and Save bars stay above the keyboard.
 *
 * The bug: with Android drawing edge to edge the window no longer shrinks when
 * the keyboard opens, so every form kept its height and scrolled its fields —
 * and its Save button — underneath. KeyboardSafe measures how far the keyboard
 * actually reaches into the screen and lifts it by exactly that much.
 */
import React from 'react';
import { Keyboard, Platform, Text } from 'react-native';
import { render, screen, act } from '@testing-library/react-native';
import KeyboardSafe from '../components/KeyboardSafe';

type Listener = (e: any) => void;
const listeners: Record<string, Listener[]> = {};

beforeEach(() => {
  Object.keys(listeners).forEach((k) => delete listeners[k]);
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((ev: string, fn: Listener) => {
    (listeners[ev] = listeners[ev] || []).push(fn);
    return { remove: () => { listeners[ev] = listeners[ev].filter((f) => f !== fn); } } as any;
  }) as any);
});

afterEach(() => jest.restoreAllMocks());

/** The screen occupies window y 80 → 880 (a header above it, 800 tall). */
function mount() {
  render(<KeyboardSafe><Text>form</Text></KeyboardSafe>);
  // React Native's test View gives each instance its own measureInWindow, so the
  // instance itself is stubbed: the screen sits at window y 80, 800 tall
  let node: any = screen.getByTestId('keyboard-safe');
  while (node && !(node.instance && node.instance.measureInWindow)) node = node.parent;
  node.instance.measureInWindow = (cb: any) => cb(0, 80, 400, 800);
}

/** Fires both the iOS and Android name for an event; the component listens for one. */
function fire(ev: string, screenY?: number) {
  const twin = ev.replace('Did', 'Will');
  [ev, twin].forEach((e) => act(() => { (listeners[e] || []).forEach((fn) => fn({ endCoordinates: { screenY, height: 0 } })); }));
}
function fireOnce(ev: string, screenY?: number) {
  act(() => { (listeners[ev] || []).forEach((fn) => fn({ endCoordinates: { screenY, height: 0 } })); });
}

/** The outer view carries the lift so absolute children move with it. */
function lift(): number {
  const outer = screen.getByTestId('keyboard-safe') as any;
  const style = [].concat(outer.props.style).reduce((a: any, s: any) => ({ ...a, ...(s || {}) }), {});
  return style.marginBottom;
}

describe('KeyboardSafe', () => {
  it('does nothing while no keyboard is up', () => {
    mount();
    expect(lift()).toBe(0);
  });

  it('lifts the screen by exactly how far the keyboard reaches into it', () => {
    mount();
    // keyboard top at 580 in a screen whose bottom is at 880 → 300 overlap
    fire('keyboardDidShow', 580);
    expect(lift()).toBe(300);
  });

  it('comes back down when the keyboard goes', () => {
    mount();
    fire('keyboardDidShow', 580);
    fire('keyboardDidHide');
    expect(lift()).toBe(0);
  });

  it('does nothing on a phone whose window still resizes, where there is no overlap', () => {
    mount();
    // keyboard top below the bottom of the screen: the window already shrank
    fire('keyboardDidShow', 900);
    expect(lift()).toBe(0);
  });

  it('follows the keyboard when it changes height, as with a suggestions bar', () => {
    const was = Platform.OS;
    (Platform as any).OS = 'android';
    mount();
    (Platform as any).OS = was;
    fire('keyboardDidShow', 580);
    fire('keyboardDidChangeFrame', 540);
    expect(lift()).toBe(340);
  });

  it('stops listening when the screen goes away', () => {
    const { unmount } = render(<KeyboardSafe><Text>x</Text></KeyboardSafe>);
    unmount();
    expect((listeners.keyboardDidShow || []).length + (listeners.keyboardWillShow || []).length).toBe(0);
  });
});
