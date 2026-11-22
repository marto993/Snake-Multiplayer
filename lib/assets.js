/*
 * Archivos de texto de public/ servidos precomprimidos (brotli y gzip) y con versión por contenido.
 *
 * - Cada archivo se comprime una sola vez (brotli calidad 11 y gzip 9, en el pool de hilos de zlib)
 *   y queda en memoria; si cambia en disco (desarrollo), se vuelve a leer y comprimir.
 * - index.html agrega `?v=<hash>` a sus scripts y hojas de estilo locales (`./…`). Esas URLs se
 *   pueden guardar un año en el navegador: cuando el archivo cambia, cambia la URL.
 * - opts.transformIndex(html, res, req): si está, index.html se arma en cada respuesta (por ejemplo, con
 *   el nonce de la CSP) y se comprime al vuelo.
 * - Lo que no es texto, o no está en public/, sigue de largo (express.static).
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const zlib = require('zlib');

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};
const YEAR = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

// Codificación preferida según Accept-Encoding: br, después gzip; respeta q=0
function pickEncoding(header) {
  const accepted = new Map();
  for (const part of String(header || '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
    accepted.set(name, q ? parseFloat(q.slice(2)) : 1);
  }
  const ok = enc => (accepted.has(enc) ? accepted.get(enc) > 0 : (accepted.get('*') || 0) > 0);
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

// Los scripts y hojas de estilo locales de index.html llevan la versión de su contenido
function versionUrls(html, versionOf) {
  return html.replace(/(<(?:script|link)\b[^>]*?\b(?:src|href)=")(\.\/[^"?#]+)(")/g, (all, before, url, after) => {
    const v = versionOf(url.slice(1));
    return v ? before + url + '?v=' + v + after : all;
  });
}

function createAssets(root, opts = {}) {
  root = path.resolve(root);
  const brQuality = opts.brotliQuality === undefined ? 11 : opts.brotliQuality;
  const cache = new Map();   // ruta url -> { mtimeMs, size, raw, hash, type, br, gzip }

  function fileFor(urlPath) {
    let rel;
    try { rel = decodeURIComponent(urlPath); } catch (e) { return null; }
    const file = path.join(root, path.normalize(rel));
    if (file !== root && !file.startsWith(root + path.sep)) return null;
    return TYPES[path.extname(file).toLowerCase()] ? file : null;
  }

  // Entrada del caché, leída de nuevo si el archivo cambió. null si no existe o no es texto.
  function entry(urlPath) {
    const file = fileFor(urlPath);
    if (!file) return null;
    let st;
    try { st = fs.statSync(file); } catch (e) { return null; }
    if (!st.isFile()) return null;
    const hit = cache.get(urlPath);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    const raw = fs.readFileSync(file);
    const e = {
      mtimeMs: st.mtimeMs, size: st.size, raw,
      hash: crypto.createHash('sha256').update(raw).digest('base64url').slice(0, 12),
      type: TYPES[path.extname(file).toLowerCase()],
      br: null, gzip: null
    };
    cache.set(urlPath, e);
    return e;
  }

  // Variante comprimida (se calcula una vez; las pedidos que llegan mientras tanto esperan la misma)
  function variant(e, enc) {
    if (!e[enc]) {
      e[enc] = enc === 'br'
        ? brotli(e.raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: brQuality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: e.raw.length } })
        : gzip(e.raw, { level: 9 });
    }
    return e[enc];
  }

  function versionOf(urlPath) {
    const e = entry(urlPath);
    return e ? e.hash : null;
  }

  // index.html con las URLs versionadas: se rearma solo cuando cambia algún archivo
  let page = null;
  function indexEntry() {
    const src = entry('/index.html');
    if (!src) return null;
    const html = versionUrls(src.raw.toString('utf8'), versionOf);
    const hash = crypto.createHash('sha256').update(html).digest('base64url').slice(0, 12);
    if (!page || page.hash !== hash) {
      page = { raw: Buffer.from(html), hash, type: TYPES['.html'], br: null, gzip: null };
    }
    return page;
  }

  async function send(req, res, e, cacheControl) {
    const enc = pickEncoding(req.headers['accept-encoding']);
    const etag = '"' + e.hash + (enc ? '-' + enc : '') + '"';
    res.setHeader('Content-Type', e.type);
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('ETag', etag);
    const inm = req.headers['if-none-match'];
    if (inm && inm.split(',').some(t => t.trim().replace(/^W\//, '') === etag)) {
      res.statusCode = 304;
      return res.end();
    }
    const body = enc ? await variant(e, enc) : e.raw;
    if (enc) res.setHeader('Content-Encoding', enc);
    res.setHeader('Content-Length', body.length);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  // index.html distinto en cada respuesta (opts.transformIndex, por ejemplo el nonce de la CSP):
  // sin ETag, porque un 304 juntaría el HTML guardado con encabezados nuevos; comprimido al vuelo
  function sendDynamic(req, res, e) {
    const html = Buffer.from(opts.transformIndex(e.raw.toString('utf8'), res, req));
    const enc = pickEncoding(req.headers['accept-encoding']);
    res.setHeader('Content-Type', e.type);
    res.setHeader('Cache-Control', REVALIDATE);
    res.setHeader('Vary', 'Accept-Encoding');
    const body = enc === 'br'
      ? zlib.brotliCompressSync(html, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
      : enc === 'gzip' ? zlib.gzipSync(html, { level: 6 }) : html;
    if (enc) res.setHeader('Content-Encoding', enc);
    res.setHeader('Content-Length', body.length);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  // Middleware de Express
  function middleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const url = new URL(req.url, 'http://x');
    const isIndex = url.pathname === '/' || url.pathname === '/index.html';
    const e = isIndex ? indexEntry() : entry(url.pathname);
    if (!e) return next();
    if (isIndex && opts.transformIndex) {
      try { sendDynamic(req, res, e); } catch (err) { next(err); }
      return;
    }
    const versioned = !isIndex && url.searchParams.get('v') === e.hash;
    send(req, res, e, versioned ? YEAR : REVALIDATE).catch(next);
  }

  // Comprime todo de antemano, sin bloquear: el primer visitante no espera a brotli
  function warm() {
    const pending = [];
    (function walk(dir) {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, d.name);
        if (d.isDirectory()) walk(full);
        else {
          const urlPath = '/' + path.relative(root, full).split(path.sep).join('/');
          const e = entry(urlPath);
          if (e) pending.push(variant(e, 'br'), variant(e, 'gzip'));
        }
      }
    })(root);
    const idx = indexEntry();
    if (idx) pending.push(variant(idx, 'br'), variant(idx, 'gzip'));
    return Promise.all(pending);
  }

  return { middleware, warm, versionOf };
}

module.exports = { createAssets, pickEncoding, versionUrls };
