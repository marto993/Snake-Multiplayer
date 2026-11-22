const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createAssets, pickEncoding, versionUrls } = require('../lib/assets');

test('pickEncoding: brotli primero, después gzip; respeta q=0', () => {
  assert.equal(pickEncoding('gzip, deflate, br'), 'br');
  assert.equal(pickEncoding('gzip'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0.8'), 'gzip');
  assert.equal(pickEncoding('*'), 'br');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(''), null);
  assert.equal(pickEncoding(undefined), null);
});

test('versionUrls: solo scripts y hojas de estilo locales (./)', () => {
  const html = '<link rel="stylesheet" href="./css/s.css"><link rel="icon" href="data:x">' +
    '<link rel="stylesheet" href="https://fonts.example/css"><script src="/socket.io/x.js"></script><script src="./a.js"></script>';
  const out = versionUrls(html, p => ({ '/css/s.css': 'H1', '/a.js': 'H2' })[p] || null);
  assert.equal(out, '<link rel="stylesheet" href="./css/s.css?v=H1"><link rel="icon" href="data:x">' +
    '<link rel="stylesheet" href="https://fonts.example/css"><script src="/socket.io/x.js"></script><script src="./a.js?v=H2"></script>');
});

// Servidor de prueba sobre una carpeta temporal
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
  fs.mkdirSync(path.join(root, 'css'));
  fs.writeFileSync(path.join(root, 'index.html'), '<link rel="stylesheet" href="./css/s.css"><script src="./a.js"></script>');
  fs.writeFileSync(path.join(root, 'css', 's.css'), 'body { color: red; }\n'.repeat(200));
  fs.writeFileSync(path.join(root, 'a.js'), 'console.log("hola");\n'.repeat(200));
  fs.writeFileSync(path.join(root, 'img.png'), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(root, '..', path.basename(root) + '-secreto.txt'), 'no');
  const assets = createAssets(root, { brotliQuality: 5 });
  const server = http.createServer((req, res) => assets.middleware(req, res, () => { res.statusCode = 404; res.end('siguiente'); }));
  const close = () => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.join(root, '..', path.basename(root) + '-secreto.txt'), { force: true });
  };
  return new Promise(resolve => server.listen(0, () => resolve({ root, assets, server: { close }, port: server.address().port })));
}
function get(port, url, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: url, method, headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('sirve comprimido, versiona index.html y cachea un año solo la URL versionada', async () => {
  const { assets, server, port } = await setup();
  try {
    const v = assets.versionOf('/a.js');
    const index = await get(port, '/', { 'accept-encoding': 'gzip, br' });
    assert.equal(index.headers['content-encoding'], 'br');
    assert.equal(index.headers['cache-control'], 'no-cache');
    assert.equal(index.headers.vary, 'Accept-Encoding');
    assert.match(zlib.brotliDecompressSync(index.body).toString(), new RegExp('src="./a.js\\?v=' + v + '"'));

    const versioned = await get(port, '/a.js?v=' + v, { 'accept-encoding': 'gzip' });
    assert.equal(versioned.headers['content-encoding'], 'gzip');
    assert.equal(versioned.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(zlib.gunzipSync(versioned.body).toString(), 'console.log("hola");\n'.repeat(200));

    const plain = await get(port, '/a.js');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.headers['cache-control'], 'no-cache');
    assert.match(plain.headers['content-type'], /^text\/javascript/);
  } finally { server.close(); }
});

test('responde 304 con el ETag de la misma codificación', async () => {
  const { server, port } = await setup();
  try {
    const first = await get(port, '/css/s.css', { 'accept-encoding': 'br' });
    const again = await get(port, '/css/s.css', { 'accept-encoding': 'br', 'if-none-match': first.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    const otherEncoding = await get(port, '/css/s.css', { 'accept-encoding': 'gzip', 'if-none-match': first.headers.etag });
    assert.equal(otherEncoding.status, 200);
  } finally { server.close(); }
});

test('si el archivo cambia en disco, cambia su versión y la de index.html', async () => {
  const { root, assets, server, port } = await setup();
  try {
    const before = assets.versionOf('/a.js');
    fs.writeFileSync(path.join(root, 'a.js'), 'console.log("chau");\n');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(root, 'a.js'), later, later);
    const after = assets.versionOf('/a.js');
    assert.notEqual(after, before);
    const index = await get(port, '/index.html');
    assert.match(index.body.toString(), new RegExp('a.js\\?v=' + after));
    const body = await get(port, '/a.js');
    assert.equal(body.body.toString(), 'console.log("chau");\n');
  } finally { server.close(); }
});

test('con transformIndex, index.html se arma en cada respuesta y va sin ETag', async () => {
  const { root, server } = await setup();   // su close() borra la carpeta: va al final
  let n = 0;
  const assets = createAssets(root, { brotliQuality: 5, transformIndex: (html, res) => { res.setHeader('X-Prueba', String(++n)); return html + '<!--' + n + '-->'; } });
  const srv = http.createServer((req, res) => assets.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;
  try {
    const a = await get(port, '/', { 'accept-encoding': 'br' });
    const b = await get(port, '/index.html', { 'accept-encoding': 'gzip' });
    assert.equal(a.headers['x-prueba'], '1');
    assert.equal(a.headers.etag, undefined);
    assert.equal(a.headers['cache-control'], 'no-cache');
    assert.match(zlib.brotliDecompressSync(a.body).toString(), /a\.js\?v=[\w-]+".*<!--1-->$/s);
    assert.match(zlib.gunzipSync(b.body).toString(), /<!--2-->$/);
    // los demás archivos siguen igual
    assert.ok((await get(port, '/a.js')).headers.etag);
  } finally { srv.close(); server.close(); }
});

test('no sale de la carpeta, deja pasar lo que no es texto y HEAD no manda cuerpo', async () => {
  const { root, server, port } = await setup();
  try {
    const escape = await get(port, '/..%2F' + path.basename(root) + '-secreto.txt');
    assert.equal(escape.status, 404);
    assert.equal((await get(port, '/img.png')).status, 404);
    assert.equal((await get(port, '/no-existe.js')).status, 404);
    const head = await get(port, '/a.js', { 'accept-encoding': 'br' }, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.ok(Number(head.headers['content-length']) > 0);
  } finally { server.close(); }
});
