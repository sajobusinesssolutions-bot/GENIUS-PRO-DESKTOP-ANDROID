/**
 * App updates for the APK build (src/data/appUpdate.ts in the app).
 *
 * The APKs are not on the website: anyone could fetch them there, and a 140 MB
 * file asked for in a loop is an easy way to fill the server's bandwidth. They
 * live in RELEASES_DIR, outside any web root, and are handed only to a signed-in
 * Genius Pro account — a few times an hour at most.
 *
 * RELEASES_DIR/latest.json names the newest build (scripts/publish-apk.sh writes it):
 *   { "versionCode": 6, "versionName": "1.5.1", "file": "genius-pro-1.5.1-6.apk", "size": 1, "notes": "" }
 */
import fs from 'node:fs';
import path from 'node:path';
import { whoami } from './sync.js';

const RELEASES_DIR = process.env.RELEASES_DIR || '/opt/genius/releases';
const FILE_SHAPE = /^genius-pro-[0-9.]+-[0-9]+\.apk$/;

function readLatest() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(RELEASES_DIR, 'latest.json'), 'utf8'));
    if (typeof j.versionCode !== 'number' || !FILE_SHAPE.test(String(j.file))) return null;
    return j;
  } catch {
    return null;
  }
}

/*
 * The Windows till's updates: latest.yml, the installer and its blockmap, as
 * electron-updater's "generic" provider asks for them. Public, like any
 * software download, but only these three shapes of name, from one folder —
 * never a path from the request. scripts/publish-desktop.sh (in the Windows
 * project) uploads them to RELEASES_DIR/desktop.
 */
const DESKTOP_DIR = path.join(RELEASES_DIR, 'desktop');
const DESKTOP_FILE = /^(latest\.yml|Genius-POS-Setup-[0-9.]+\.exe(\.blockmap)?)$/;

export default async function updateRoutes(app) {
  app.get('/v1/desktop/:file', {
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const name = String(req.params.file || '');
    if (!DESKTOP_FILE.test(name)) return reply.code(404).send({ error: 'notFound' });
    const full = path.join(DESKTOP_DIR, name);
    let st;
    try { st = fs.statSync(full); } catch { return reply.code(404).send({ error: 'notFound' }); }
    reply
      .header('content-type', name.endsWith('.yml') ? 'text/yaml; charset=utf-8' : 'application/octet-stream')
      .header('content-length', st.size)
      .header('cache-control', name.endsWith('.yml') ? 'no-cache' : 'public, max-age=86400');
    return reply.send(fs.createReadStream(full));
  });

  app.get('/v1/app/latest', {
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    if (!(await whoami(req, reply))) return reply;
    const j = readLatest();
    if (!j) return { versionCode: 0 };
    return {
      versionCode: j.versionCode,
      versionName: j.versionName,
      url: '/v1/app/apk/' + j.file,
      size: j.size,
      notes: j.notes || '',
    };
  });

  app.get('/v1/app/apk/:file', {
    config: { rateLimit: { max: 4, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    if (!(await whoami(req, reply))) return reply;
    const j = readLatest();
    // only the current build, by its exact name — never a path from the request
    if (!j || req.params.file !== j.file) return reply.code(404).send({ error: 'notFound' });
    const full = path.join(RELEASES_DIR, j.file);
    let size;
    try { size = fs.statSync(full).size; } catch { return reply.code(404).send({ error: 'notFound' }); }
    reply
      .header('content-type', 'application/vnd.android.package-archive')
      .header('content-length', size)
      .header('cache-control', 'private, no-store');
    return reply.send(fs.createReadStream(full));
  });
}
