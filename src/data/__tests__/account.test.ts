/**
 * The rules the sign-up applies before it will let an account be made. Each
 * exists to stop a specific way of losing an account: an address that was never
 * really typed, a password that is the email again, an account whose email was
 * never confirmed being treated as though it had been.
 */
import { emailLooksReal, checkPassword, codeLooksReal, newAccount } from '../account';

describe('emailLooksReal', () => {
  it('accepts an ordinary address', () => {
    expect(emailLooksReal('owner@example.com')).toBe(true);
    expect(emailLooksReal('ada.nakato+shop@mail.co.ug')).toBe(true);
  });

  it('catches the usual typos', () => {
    expect(emailLooksReal('owner')).toBe(false);
    expect(emailLooksReal('owner@')).toBe(false);
    expect(emailLooksReal('@example.com')).toBe(false);
    expect(emailLooksReal('owner@example')).toBe(false);
    expect(emailLooksReal('owner@example.')).toBe(false);
    expect(emailLooksReal('own er@example.com')).toBe(false);
    expect(emailLooksReal('a@b@example.com')).toBe(false);
  });

  it('does not try to be cleverer than the confirmation code', () => {
    // unusual but real; rejecting these is worse than letting the code prove it
    expect(emailLooksReal("o'brien@example.com")).toBe(true);
    expect(emailLooksReal('shop_2@sub.domain.example.com')).toBe(true);
  });
});

describe('checkPassword', () => {
  it('refuses anything under eight characters, and says so', () => {
    const v = checkPassword('abc123');
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/at least 8/);
  });

  it('accepts a long passphrase with no symbols in it', () => {
    expect(checkPassword('sugar and salt and rice').ok).toBe(true);
  });

  it('accepts a shorter one that has some variety', () => {
    expect(checkPassword('Shop2026!').ok).toBe(true);
  });

  it('refuses a short one with no variety, and says which of the two to fix', () => {
    const v = checkPassword('shopshop');
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/12 characters or longer/);
    expect(v.why).toMatch(/capitals, numbers or symbols/);
  });

  it('refuses the email address as a password', () => {
    const v = checkPassword('adanakato2026', 'adanakato@example.com');
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/email address/);
  });

  it('refuses one character held down', () => {
    expect(checkPassword('aaaaaaaaaaaa').ok).toBe(false);
  });

  it('rates a long one strong and a just-acceptable one middling', () => {
    expect(checkPassword('correct horse battery staple').strength).toBe(3);
    expect(checkPassword('Shop2026!').strength).toBe(2);
  });
});

describe('codeLooksReal', () => {
  it('wants exactly six digits', () => {
    expect(codeLooksReal('123456')).toBe(true);
    expect(codeLooksReal(' 123456 ')).toBe(true);
    expect(codeLooksReal('12345')).toBe(false);
    expect(codeLooksReal('1234567')).toBe(false);
    expect(codeLooksReal('12345a')).toBe(false);
    expect(codeLooksReal('')).toBe(false);
  });
});

describe('newAccount', () => {
  it('lowercases and trims the email, so signing in later matches', () => {
    const a = newAccount({ email: '  Owner@Example.COM ', name: 'Ada', method: 'password', verified: true, localOnly: false });
    expect(a.email).toBe('owner@example.com');
  });

  it('remembers that an account made with no server is not yet real anywhere else', () => {
    const a = newAccount({ email: 'o@e.com', name: 'Ada', method: 'password', verified: false, localOnly: true });
    expect(a.localOnly).toBe(true);
    expect(a.verified).toBe(false);
    expect(a.id).toBe('');
  });

  it('keeps the server id and refresh token when there was a server', () => {
    const a = newAccount({
      email: 'o@e.com', name: 'Ada', method: 'google', verified: true, localOnly: false,
      id: 'acct_1', refresh: 'r_1',
    });
    expect(a.id).toBe('acct_1');
    expect(a.refresh).toBe('r_1');
    expect(a.method).toBe('google');
  });
});
