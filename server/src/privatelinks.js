/**
 * Private download links for clients: the latest phone app and the latest
 * Windows installer, behind a secret that is never on the website.
 *
 *   GET /v1/get/:key/android   the newest APK (latest.json names it)
 *   GET /v1/get/:key/windows   the newest Windows installer (latest.yml names it)
 *
 * The key is DOWNLOAD_KEY in /etc/genius/api.env (deploy/privatelinks-install.sh
 * makes one). A wrong key answers 404, as if nothing were there. Changing the
 * key retires every link handed out with the old one. Each link always serves
 * the newest build, so a link sent last month still installs today's app.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const RELEASES_DIR = process.env.RELEASES_DIR || '/opt/genius/releases';
const DESKTOP_DIR = path.join(RELEASES_DIR, 'desktop');

function keyOk(given) {
  const want = String(process.env.DOWNLOAD_KEY || '');
  const got = String(given || '');
  if (want.length < 16 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

function latestApk() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(RELEASES_DIR, 'latest.json'), 'utf8'));
    if (!j || !/^[\w.-]+\.apk$/.test(String(j.file || ''))) return null;
    return { full: path.join(RELEASES_DIR, j.file), name: 'Genius-POS-' + (j.versionName || 'latest') + '.apk' };
  } catch { return null; }
}

function latestExe() {
  try {
    const yml = fs.readFileSync(path.join(DESKTOP_DIR, 'latest.yml'), 'utf8');
    const m = yml.match(/^path:\s*(Genius-POS-Setup-[0-9.]+\.exe)\s*$/m);
    if (!m) return null;
    return { full: path.join(DESKTOP_DIR, m[1]), name: m[1] };
  } catch { return null; }
}

export default async function privateLinkRoutes(app) {
  app.get('/v1/get/:key/:what', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    if (!keyOk(req.params.key)) return reply.code(404).send({ error: 'notFound' });
    const what = String(req.params.what || '');
    const file = what === 'android' ? latestApk() : what === 'windows' ? latestExe() : null;
    if (!file) return reply.code(404).send({ error: 'notFound' });
    let size;
    try { size = fs.statSync(file.full).size; } catch { return reply.code(404).send({ error: 'notFound' }); }
    reply
      .header('content-type', what === 'android' ? 'application/vnd.android.package-archive' : 'application/octet-stream')
      .header('content-length', size)
      .header('content-disposition', 'attachment; filename="' + file.name + '"')
      .header('cache-control', 'private, no-store')
      .header('x-robots-tag', 'noindex, nofollow');
    return reply.send(fs.createReadStream(file.full));
  });
}
