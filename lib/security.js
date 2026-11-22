/*
 * Política de seguridad de contenido (CSP) de la página, en modo solo-reporte.
 *
 * Política estricta con nonce (guía security/security de Modern Web Guidance): cada respuesta de
 * index.html lleva un nonce nuevo en todos sus <script>; 'strict-dynamic' deja cargar lo que esos
 * scripts carguen, y Trusted Types reporta cualquier escritura de HTML como texto en el DOM.
 * Por ahora es Content-Security-Policy-Report-Only: no bloquea nada, solo avisa a /csp-report.
 * Cuando los reportes muestren que no rompe nada, se pasa a Content-Security-Policy.
 */
'use strict';
const crypto = require('crypto');

const REPORT_PATH = '/csp-report';
const REPORT_GROUP = 'csp';

function newNonce() {
  return crypto.randomBytes(16).toString('base64');
}

// frame-ancestors no va acá: en modo solo-reporte el navegador lo ignora (y avisa en la consola)
function cspReportOnly(nonce) {
  return [
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'report-sample'`,
    "object-src 'none'",
    "base-uri 'none'",
    "require-trusted-types-for 'script'",
    `report-uri ${REPORT_PATH}`,    // Firefox y Safari
    `report-to ${REPORT_GROUP}`     // Chromium (si está, ignora report-uri)
  ].join('; ');
}

function addNonce(html, nonce) {
  return html.replace(/<script\b/g, `<script nonce="${nonce}"`);
}

// URL absoluta de la ruta de reportes: Reporting-Endpoints no acepta rutas relativas.
// Detrás del proxy de Fly el protocolo viene en X-Forwarded-Proto.
function reportUrl(req) {
  const host = String(req && req.headers && req.headers.host || '');
  if (!/^[\w.-]+(:\d+)?$/.test(host)) return null;
  const fwd = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = fwd === 'https' || fwd === 'http' ? fwd : (req.socket && req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${host}${REPORT_PATH}`;
}

// Encabezados de seguridad de una respuesta de index.html; devuelve el HTML con el nonce
function secureIndex(html, res, req) {
  const nonce = newNonce();
  const endpoint = reportUrl(req);
  if (endpoint) res.setHeader('Reporting-Endpoints', `${REPORT_GROUP}="${endpoint}"`);
  res.setHeader('Content-Security-Policy-Report-Only', cspReportOnly(nonce));
  return addNonce(html, nonce);
}

// Sin query strings ni fragmentos en los registros (pueden llevar datos)
function stripUrl(u) {
  if (typeof u !== 'string') return undefined;
  return u.split(/[?#]/)[0].slice(0, 200);
}

// Resumen de un reporte, en los dos formatos: Reporting API (array de { type, body }) y
// report-uri ({ "csp-report": { ... } }). Devuelve una lista de resúmenes cortos.
function summarizeReports(payload) {
  const items = Array.isArray(payload) ? payload : (payload && payload['csp-report'] ? [payload] : []);
  const out = [];
  for (const it of items.slice(0, 20)) {
    if (it && it['csp-report']) {
      const r = it['csp-report'];
      out.push({
        directive: String(r['effective-directive'] || r['violated-directive'] || '').slice(0, 80),
        blocked: stripUrl(r['blocked-uri']),
        source: stripUrl(r['source-file']),
        line: r['line-number'],
        sample: typeof r['script-sample'] === 'string' ? r['script-sample'].slice(0, 40) : undefined
      });
    } else if (it && it.type === 'csp-violation' && it.body) {
      const b = it.body;
      out.push({
        directive: String(b.effectiveDirective || '').slice(0, 80),
        blocked: stripUrl(b.blockedURL),
        source: stripUrl(b.sourceFile),
        line: b.lineNumber,
        sample: typeof b.sample === 'string' ? b.sample.slice(0, 40) : undefined
      });
    }
  }
  return out;
}

// Ruta que registra los reportes, con un tope por minuto para que no llenen los logs
function reportHandler(log = console.warn, perMinute = 30) {
  let windowStart = 0, count = 0;
  return function (req, res) {
    const now = Date.now();
    if (now - windowStart > 60000) { windowStart = now; count = 0; }
    for (const r of summarizeReports(req.body)) {
      if (++count > perMinute) break;
      log('CSP (solo reporte):', JSON.stringify(r));
    }
    res.status(204).end();
  };
}

const REPORT_TYPES = ['application/reports+json', 'application/csp-report', 'application/json'];

module.exports = { REPORT_PATH, REPORT_TYPES, cspReportOnly, addNonce, secureIndex, summarizeReports, reportHandler };
