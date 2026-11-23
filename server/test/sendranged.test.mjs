/**
 * Installers sent in parts (src/sendranged.js), as electron-updater asks for
 * the changed blocks: whole, one range, many ranges as multipart/byteranges
 * (each part's bytes checked), and a range that cannot be served.
 *
 *   node --test test/sendranged.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { sendRanged, parseRanges } from '../src/sendranged.js';

const file = path.join(os.tmpdir(), `ranged-${process.pid}.bin`);
const data = crypto.randomBytes(300000);
fs.writeFileSync(file, data);
const app = Fastify();
app.get('/f', (req, reply) => sendRanged(req, reply, file, data.length, { 'content-type': 'application/octet-stream' }));
await app.ready();

test('whole, with Accept-Ranges said', async () => {
  const r = await app.inject({ method: 'GET', url: '/f' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['accept-ranges'], 'bytes');
  assert.ok(r.rawPayload.equals(data));
});

test('one range', async () => {
  const r = await app.inject({ method: 'GET', url: '/f', headers: { range: 'bytes=1000-1999' } });
  assert.equal(r.statusCode, 206);
  assert.equal(r.headers['content-range'], `bytes 1000-1999/${data.length}`);
  assert.ok(r.rawPayload.equals(data.subarray(1000, 2000)));
  const tail = await app.inject({ method: 'GET', url: '/f', headers: { range: 'bytes=-500' } });
  assert.ok(tail.rawPayload.equals(data.subarray(data.length - 500)));
});

test('many ranges at once, as multipart/byteranges, each part its own bytes', async () => {
  const want = [[0, 99], [5000, 5999], [123456, 199999], [299990, 299999]];
  const r = await app.inject({ method: 'GET', url: '/f', headers: { range: 'bytes=' + want.map(([a, b]) => `${a}-${b}`).join(',') } });
  assert.equal(r.statusCode, 206);
  const boundary = /boundary=(\S+)/.exec(r.headers['content-type'])[1];
  assert.match(r.headers['content-type'], /^multipart\/byteranges; boundary=/);
  const body = r.rawPayload;
  assert.equal(Number(r.headers['content-length']), body.length);
  /* read it back the way a client does: each part's Content-Range, then exactly that many bytes */
  let at = 0, i = 0;
  const sep = Buffer.from(`--${boundary}`);
  for (;;) {
    at = body.indexOf(sep, at) + sep.length;
    if (body.subarray(at, at + 2).toString() === '--') break;
    const headEnd = body.indexOf('\r\n\r\n', at);
    const [, a, b, total] = /Content-Range: bytes (\d+)-(\d+)\/(\d+)/.exec(body.subarray(at, headEnd).toString());
    assert.deepEqual([Number(a), Number(b), Number(total)], [...want[i], data.length]);
    const start = headEnd + 4;
    assert.ok(body.subarray(start, start + (b - a + 1)).equals(data.subarray(Number(a), Number(b) + 1)), `part ${i}`);
    at = start + (b - a + 1);
    i++;
  }
  assert.equal(i, want.length);
});

test('a range that cannot be served is refused (416)', async () => {
  const r = await app.inject({ method: 'GET', url: '/f', headers: { range: 'bytes=400000-500000' } });
  assert.equal(r.statusCode, 416);
  assert.equal(r.headers['content-range'], `bytes */${data.length}`);
  assert.equal(parseRanges('bytes=5-1', 100), null);
  assert.equal(parseRanges('items=1-2', 100), null);
  assert.deepEqual(parseRanges('bytes=90-', 100), [[90, 99]]);
});

test.after(() => { fs.unlinkSync(file); });
