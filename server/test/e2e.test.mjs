/**
 * Black-box checks for a running Genius sync server.
 *
 * Run with:
 *   E2E_BASE_URL=http://127.0.0.1:8080 E2E_ACCESS_TOKEN=... npm test
 *
 * The credentialed checks are deliberately skipped when the environment is
 * not configured. They are intended for CI or a disposable staging database,
 * never for a developer's production account.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = String(process.env.E2E_BASE_URL || '').replace(/\/$/, '');
const token = String(process.env.E2E_ACCESS_TOKEN || '');
const businessA = String(process.env.E2E_BUSINESS_A || '');
const businessB = String(process.env.E2E_BUSINESS_B || '');
const credentialed = Boolean(base && token);

async function request(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await fetch(base + path, { ...options, headers });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* report status below */ }
  return { response, body };
}

test('server health is reachable', { skip: !base }, async () => {
  const { response, body } = await request('/health');
  assert.equal(response.status, 200);
  assert.equal(typeof body.ok, 'boolean');
});

test('sign-in protected routes reject an absent session', { skip: !base }, async () => {
  const { response, body } = await request('/v1/businesses');
  assert.equal(response.status, 401);
  assert.equal(body.error, 'badCredentials');
});

test('sync failure is reported as an auth failure, not a successful push', { skip: !base }, async () => {
  const { response, body } = await request('/v1/sync/push', {
    method: 'POST',
    headers: { authorization: 'Bearer deliberately-invalid' },
    body: JSON.stringify({ ops: [] }),
  });
  assert.equal(response.status, 401);
  assert.equal(body.error, 'badCredentials');
});

test('business switching only opens businesses visible to the account', { skip: !(credentialed && businessA && businessB) }, async () => {
  const headers = { authorization: 'Bearer ' + token };
  const first = await request('/v1/businesses/' + businessA + '/snapshot', { headers });
  const second = await request('/v1/businesses/' + businessB + '/snapshot', { headers });
  assert.notEqual(first.response.status, 403);
  assert.notEqual(second.response.status, 403);
  assert.ok([200, 404].includes(first.response.status));
  assert.ok([200, 404].includes(second.response.status));
});

test('an authenticated sync request names a real business', { skip: !(credentialed && businessA) }, async () => {
  const { response, body } = await request('/v1/sync/pull?business=' + encodeURIComponent(businessA), {
    headers: { authorization: 'Bearer ' + token },
  });
  assert.notEqual(response.status, 401);
  assert.notEqual(body.error, 'badCredentials');
  assert.notEqual(response.status, 403);
});