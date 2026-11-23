/**
 * A file sent whole, or only the parts asked for (HTTP Range), so a computer
 * updating Genius POS or Tallix downloads just the blocks that changed.
 *
 * electron-updater compares the blockmaps of the old and new installers and
 * asks for the changed blocks — often 3% of a 90 MB installer — in requests of
 * many ranges at once ("Range: bytes=0-99,5000-5999,…"), which must come back
 * as 206 multipart/byteranges. A server that answers 200 with the whole file
 * makes it give up and download all of it, which is what every till did.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

const MAX_RANGES = 5000;

/** [[start, end], …] from a Range header, or null if it cannot be served (→ 416); undefined if there is none. */
export function parseRanges(header, size) {
  if (!header) return undefined;
  const m = /^bytes=(.+)$/i.exec(String(header).trim());
  if (!m) return null;
  const out = [];
  for (const part of m[1].split(',')) {
    const p = part.trim();
    let a, b;
    const r = /^(\d*)-(\d*)$/.exec(p);
    if (!r || (r[1] === '' && r[2] === '')) return null;
    if (r[1] === '') { const n = Number(r[2]); if (!n) return null; a = Math.max(0, size - n); b = size - 1; }
    else { a = Number(r[1]); b = r[2] === '' ? size - 1 : Math.min(Number(r[2]), size - 1); }
    if (!(a <= b) || a >= size) return null;
    out.push([a, b]);
    if (out.length > MAX_RANGES) return null;
  }
  return out.length ? out : null;
}

/**
 * Send a file from disk: whole (200), one part (206), or several (206
 * multipart/byteranges). headers: content-type, cache-control and the like.
 */
export function sendRanged(req, reply, full, size, headers = {}) {
  const type = headers['content-type'] || 'application/octet-stream';
  for (const [k, v] of Object.entries(headers)) reply.header(k, v);
  reply.header('accept-ranges', 'bytes');
  const ranges = req.method === 'HEAD' ? undefined : parseRanges(req.headers.range, size);
  if (ranges === undefined) {
    reply.header('content-length', size);
    return reply.send(fs.createReadStream(full));
  }
  if (ranges === null) {
    return reply.code(416).header('content-range', `bytes */${size}`).send();
  }
  if (ranges.length === 1) {
    const [a, b] = ranges[0];
    reply.code(206).header('content-range', `bytes ${a}-${b}/${size}`).header('content-length', b - a + 1);
    return reply.send(fs.createReadStream(full, { start: a, end: b }));
  }
  const boundary = 'gp' + crypto.randomBytes(12).toString('hex');
  const heads = ranges.map(([a, b]) => Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${type}\r\nContent-Range: bytes ${a}-${b}/${size}\r\n\r\n`));
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const length = heads.reduce((t, h, i) => t + h.length + (ranges[i][1] - ranges[i][0] + 1), 0) + tail.length;
  async function* body() {
    for (let i = 0; i < ranges.length; i++) {
      yield heads[i];
      for await (const chunk of fs.createReadStream(full, { start: ranges[i][0], end: ranges[i][1] })) yield chunk;
    }
    yield tail;
  }
  reply.code(206).header('content-type', `multipart/byteranges; boundary=${boundary}`).header('content-length', length);
  return reply.send(Readable.from(body()));
}
