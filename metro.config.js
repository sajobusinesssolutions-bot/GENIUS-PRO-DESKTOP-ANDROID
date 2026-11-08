/**
 * metro.config.js — only what running the app in a browser for testing needs
 * (`npm run web`); a phone build is unaffected beyond knowing .wasm files.
 *
 *  - expo-sqlite's web worker loads wa-sqlite.wasm, so .wasm is an asset, and
 *    the page is served cross-origin isolated (COOP/COEP), which it needs.
 *  - The account server answers apps, not web pages (no CORS), so the dev
 *    server passes /__api/* through to it: same origin, nothing to refuse.
 *    The browser build points SERVER_URL there (src/data/authApi.ts).
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');

const UPSTREAM = process.env.GENIUS_API_UPSTREAM || 'https://api.saljoetech.tech';

config.server = config.server || {};
const previous = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const inner = previous ? previous(middleware, server) : middleware;
  return async (req, res, next) => {
    if (req.url && req.url.startsWith('/__api/')) {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const headers = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (!['host', 'origin', 'referer', 'connection', 'accept-encoding'].includes(k)) headers[k] = v;
        }
        const r = await fetch(UPSTREAM + req.url.slice('/__api'.length), {
          method: req.method,
          headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
        });
        res.statusCode = r.status;
        r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v); });
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch (e) {
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'offline', message: 'The test proxy could not reach the server: ' + e.message }));
      }
      return;
    }
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return inner(req, res, next);
  };
};

module.exports = config;
