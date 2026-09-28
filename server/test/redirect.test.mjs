/**
 * Which addresses the server is willing to hand a sign-in ticket to.
 *
 * This is the guard that stops /v1/auth/google/start becoming an open
 * redirector. It has to be loose enough for Expo Go — which cannot register a
 * custom scheme, so during development the ticket must come back through
 * `exp://` — and tight enough that nobody can have one delivered to a host of
 * their choosing.
 *
 * Run with:  node --test server/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedRedirect } from '../src/redirect.js';

test('the app\'s own scheme is always allowed', () => {
  assert.equal(allowedRedirect('geniuspos://oauth'), true);
  assert.equal(allowedRedirect('geniuspos://oauth?x=1'), true);
});

test('Expo Go on the local network is allowed, since it cannot use a scheme', () => {
  assert.equal(allowedRedirect('exp://192.168.1.192:8081/--/oauth'), true);
  assert.equal(allowedRedirect('exp://10.0.0.5:8081/--/oauth'), true);
  assert.equal(allowedRedirect('exp://172.16.4.2:19000/--/oauth'), true);
  assert.equal(allowedRedirect('exp://172.31.255.254:8081/--/oauth'), true);
  assert.equal(allowedRedirect('exp://localhost:8081/--/oauth'), true);
  assert.equal(allowedRedirect('exp://127.0.0.1:8081/--/oauth'), true);
});

test('Expo Go pointed at the open internet is refused', () => {
  // the whole point: a ticket must not be deliverable to somebody else's machine
  assert.equal(allowedRedirect('exp://evil.example.com/--/oauth'), false);
  assert.equal(allowedRedirect('exp://8.8.8.8:8081/--/oauth'), false);
  assert.equal(allowedRedirect('exp://203.0.113.9/--/oauth'), false);
  assert.equal(allowedRedirect('exp://172.32.0.1/--/oauth'), false);
  assert.equal(allowedRedirect('exp://172.15.0.1/--/oauth'), false);
  assert.equal(allowedRedirect('exp://193.168.1.1/--/oauth'), false);
});

test('ordinary web addresses are refused outright', () => {
  assert.equal(allowedRedirect('https://evil.example.com'), false);
  assert.equal(allowedRedirect('http://192.168.1.1'), false);
  assert.equal(allowedRedirect('//evil.example.com'), false);
  assert.equal(allowedRedirect('javascript:alert(1)'), false);
});

test('nothing at all is refused, rather than defaulting to allowed', () => {
  assert.equal(allowedRedirect(''), false);
  assert.equal(allowedRedirect(undefined), false);
  assert.equal(allowedRedirect(null), false);
});

test('a scheme that merely starts the same way is not enough', () => {
  assert.equal(allowedRedirect('notgeniuspos://oauth'), false);
  assert.equal(allowedRedirect('exponential://192.168.1.1'), false);
  assert.equal(allowedRedirect('exp+other://192.168.1.1'), false);
});

test('the Windows till on this computer is allowed, on loopback only', () => {
  assert.equal(allowedRedirect('http://127.0.0.1:3000/api/auth/cloud/google/return?n=abc'), true);
  assert.equal(allowedRedirect('http://localhost:3000/api/auth/cloud/google/return'), true);
});

test('loopback-looking addresses that are not loopback are refused', () => {
  assert.equal(allowedRedirect('http://127.0.0.1.evil.com:3000/api/auth/x'), false);
  assert.equal(allowedRedirect('http://evil.com@127.0.0.1:3000/api/auth/x'), false);
  assert.equal(allowedRedirect('http://127.0.0.1/api/auth/x'), false);
  assert.equal(allowedRedirect('https://127.0.0.1:3000/api/auth/x'), false);
  assert.equal(allowedRedirect('http://127.0.0.1:3000/somewhere-else'), false);
  assert.equal(allowedRedirect('http://192.168.1.5:3000/api/auth/x'), false);
});
