import React from 'react';
import { Linking, Share } from 'react-native';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react-native';

const mockDb: any = { settings: { theme: 'light' }, session: { till: 'Till 1' } };
const mockGo = jest.fn();
jest.mock('../data/AppDataContext', () => ({ useAppData: () => ({ db: mockDb }), useAppDataSafe: () => ({ db: mockDb }) }));
jest.mock('../nav/navigate', () => ({ useGo: () => mockGo }));

import { ToastProvider } from '../components/Toast';
import HelpScreen, { FaqScreen, FAQS } from '../screens/HelpScreen';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP } from '../data/support';

const openURL = jest.spyOn(Linking, 'openURL');
const share = jest.spyOn(Share, 'share');

beforeEach(() => {
  jest.useFakeTimers();
  mockGo.mockReset();
  openURL.mockReset().mockResolvedValue(true as any);
  share.mockReset().mockResolvedValue({ action: 'sharedAction' } as any);
});
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); cleanup(); });

const wrap = () => render(<ToastProvider><HelpScreen /></ToastProvider>);

describe('Help & about', () => {
  it('holds support, the app, and the legal pages', () => {
    wrap();
    for (const t of ['FAQs & help', 'WhatsApp support', 'Email support', 'Feature request', 'App & updates',
      'Plan & licence', 'Share the app', 'Privacy policy', 'Terms and conditions']) expect(screen.getByText(t)).toBeTruthy();
  });

  it('opens WhatsApp support with a message ready to send', async () => {
    wrap();
    await act(async () => { fireEvent.press(screen.getByText('WhatsApp support')); });
    expect(openURL.mock.calls[0][0]).toMatch(new RegExp('^https://wa\\.me/' + SUPPORT_WHATSAPP + '\\?text=.+'));
  });

  it('opens an email to support with the version and till filled in', async () => {
    wrap();
    await act(async () => { fireEvent.press(screen.getByText('Email support')); });
    const url = decodeURIComponent(openURL.mock.calls[0][0]);
    expect(url.startsWith('mailto:' + SUPPORT_EMAIL + '?subject=Genius POS support')).toBe(true);
    expect(url).toContain('till Till 1');
  });

  it('a feature request is its own email subject', async () => {
    wrap();
    await act(async () => { fireEvent.press(screen.getByText('Feature request')); });
    expect(decodeURIComponent(openURL.mock.calls[0][0])).toContain('subject=Feature request');
  });

  it('shares the app through the system share sheet', async () => {
    wrap();
    await act(async () => { fireEvent.press(screen.getByText('Share the app')); });
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining('Genius POS') });
  });

  it('goes to the right screens', () => {
    wrap();
    fireEvent.press(screen.getByText('FAQs & help'));
    fireEvent.press(screen.getByText('App & updates'));
    fireEvent.press(screen.getByText('Plan & licence'));
    fireEvent.press(screen.getByText('Privacy policy'));
    expect(mockGo.mock.calls).toEqual([['Faq'], ['About'], ['Plans'], ['Legal', { doc: 'privacy' }]]);
  });

  it('says so when no app can open the link', async () => {
    openURL.mockRejectedValue(new Error('no handler'));
    wrap();
    await act(async () => { fireEvent.press(screen.getByText('Email support')); });
    expect(screen.getByText('No app on this phone can open email.')).toBeTruthy();
  });
});

describe('FAQs', () => {
  it('opens one answer at a time', () => {
    render(<FaqScreen />);
    expect(screen.getByText(FAQS[0].a)).toBeTruthy();
    fireEvent.press(screen.getByText(FAQS[1].q));
    expect(screen.getByText(FAQS[1].a)).toBeTruthy();
    expect(screen.queryByText(FAQS[0].a)).toBeNull();
  });
});
