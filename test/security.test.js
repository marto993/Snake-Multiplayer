const test = require('node:test');
const assert = require('node:assert/strict');
const { cspReportOnly, addNonce, secureIndex, summarizeReports, reportHandler } = require('../lib/security');

test('la política es estricta con nonce, Trusted Types y reportes, sin frame-ancestors', () => {
  const p = cspReportOnly('abc123');
  assert.match(p, /script-src 'nonce-abc123' 'strict-dynamic' 'report-sample'/);
  assert.match(p, /object-src 'none'/);
  assert.match(p, /base-uri 'none'/);
  assert.match(p, /require-trusted-types-for 'script'/);
  assert.match(p, /report-uri \/csp-report/);
  assert.match(p, /report-to csp/);
  assert.doesNotMatch(p, /frame-ancestors/);
});

test('el nonce va en cada <script> y en nada más', () => {
  const html = '<script src="/a.js"></script><noscript>x</noscript><script>1</script><p>script</p>';
  assert.equal(addNonce(html, 'N'), '<script nonce="N" src="/a.js"></script><noscript>x</noscript><script nonce="N">1</script><p>script</p>');
});

test('secureIndex pone los encabezados con el mismo nonce que el HTML y cambia en cada respuesta', () => {
  const headers = () => { const h = {}; return { h, setHeader: (k, v) => { h[k] = v; } }; };
  const req = { headers: { host: 'snake.example', 'x-forwarded-proto': 'https' } };
  const a = headers(), b = headers();
  const htmlA = secureIndex('<script src="/x.js"></script>', a, req);
  const htmlB = secureIndex('<script src="/x.js"></script>', b, req);
  const nonceA = htmlA.match(/nonce="([^"]+)"/)[1];
  assert.ok(a.h['Content-Security-Policy-Report-Only'].includes(`'nonce-${nonceA}'`));
  assert.notEqual(nonceA, htmlB.match(/nonce="([^"]+)"/)[1]);
});

test('Reporting-Endpoints lleva una URL absoluta (detrás del proxy, con su protocolo)', () => {
  const run = (headers, socket) => { const h = {}; secureIndex('', { setHeader: (k, v) => { h[k] = v; } }, { headers, socket }); return h['Reporting-Endpoints']; };
  assert.equal(run({ host: 'snake.example', 'x-forwarded-proto': 'https' }), 'csp="https://snake.example/csp-report"');
  assert.equal(run({ host: 'localhost:3000' }, {}), 'csp="http://localhost:3000/csp-report"');
  assert.equal(run({ host: 'localhost:3000' }, { encrypted: true }), 'csp="https://localhost:3000/csp-report"');
  // un Host raro no se copia en el encabezado
  assert.equal(run({ host: 'evil.example/x"y' }), undefined);
  assert.equal(run({}), undefined);
});

test('resume los dos formatos de reporte, sin query strings', () => {
  const reportingApi = [{ type: 'csp-violation', body: {
    effectiveDirective: 'require-trusted-types-for', blockedURL: 'trusted-types-sink',
    sourceFile: 'https://x.dev/SnakeGame.js?v=abc#f', lineNumber: 12, sample: 'Element innerHTML|' + 'x'.repeat(100)
  } }, { type: 'deprecation', body: {} }];
  assert.deepEqual(summarizeReports(reportingApi), [{
    directive: 'require-trusted-types-for', blocked: 'trusted-types-sink',
    source: 'https://x.dev/SnakeGame.js', line: 12, sample: ('Element innerHTML|' + 'x'.repeat(100)).slice(0, 40)
  }]);
  const legacy = { 'csp-report': { 'violated-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?token=1', 'line-number': 3 } };
  assert.deepEqual(summarizeReports(legacy), [{ directive: 'script-src-elem', blocked: 'https://evil.example/x.js', source: undefined, line: 3, sample: undefined }]);
  assert.deepEqual(summarizeReports(null), []);
  assert.deepEqual(summarizeReports('basura'), []);
});

test('la ruta de reportes responde 204 y no registra más de N por minuto', () => {
  const logged = [];
  const handler = reportHandler((...args) => logged.push(args), 3);
  const report = { 'csp-report': { 'violated-directive': 'script-src-elem' } };
  let status = 0;
  const res = { status(s) { status = s; return this; }, end() {} };
  for (let i = 0; i < 5; i++) handler({ body: report }, res);
  assert.equal(status, 204);
  assert.equal(logged.length, 3);
});
