const test = require('node:test');
const assert = require('node:assert/strict');
const { PadInput } = require('../public/js/input/pad.js');

// Mando simulado: mapeo estándar (o el que se pase), ejes del stick izquierdo y botones apretados
function pad({ x = 0, y = 0, pressed = [], mapping = 'standard' } = {}) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
  return { mapping, axes: [x, y, 0, 0], buttons, connected: true };
}
const read = gp => PadInput.read(gp, { angle: null, fire: false });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≉ ${b}`);

test('stick en reposo (dentro de la zona muerta): sin rumbo ni disparo', () => {
  assert.deepEqual(read(pad({ x: 0.2, y: -0.15 })), { angle: null, fire: false });
  assert.equal(PadInput.DEADZONE, 0.3);
});

test('stick: el rumbo es hacia donde se empuja (y crece hacia abajo)', () => {
  near(read(pad({ x: 1, y: 0 })).angle, 0);
  near(read(pad({ x: 0, y: 1 })).angle, Math.PI / 2);
  near(read(pad({ x: -0.5, y: 0 })).angle, Math.PI);
});

test('cruceta: ocho rumbos, como las flechas', () => {
  near(read(pad({ pressed: [15] })).angle, 0);            // derecha
  near(read(pad({ pressed: [12, 15] })).angle, -Math.PI / 4); // arriba + derecha
  near(read(pad({ pressed: [13, 14] })).angle, 3 * Math.PI / 4); // abajo + izquierda
  assert.equal(read(pad({ pressed: [14, 15] })).angle, null);  // izquierda + derecha se anulan
});

test('el stick fuera de la zona muerta manda sobre la cruceta', () => {
  near(read(pad({ x: 0, y: -1, pressed: [15] })).angle, -Math.PI / 2);
});

test('disparo: A o gatillo derecho; B no', () => {
  assert.equal(read(pad({ pressed: [0] })).fire, true);
  assert.equal(read(pad({ pressed: [7] })).fire, true);
  assert.equal(read(pad({ pressed: [1] })).fire, false);
  assert.equal(read(pad()).fire, false);
});

test('gatillo analógico: dispara pasada la mitad del recorrido', () => {
  const gp = pad();
  gp.buttons[7] = { pressed: false, value: 0.6 };
  assert.equal(read(gp).fire, true);
  gp.buttons[7] = { pressed: false, value: 0.3 };
  assert.equal(read(gp).fire, false);
});

test('mando sin mapeo estándar: primer par de ejes y cualquiera de los cuatro primeros botones', () => {
  const gp = pad({ x: 1, y: 0, pressed: [3], mapping: '' });
  const r = read(gp);
  near(r.angle, 0);
  assert.equal(r.fire, true);
  // sin mapeo estándar la cruceta no se interpreta (sus índices cambian de un mando a otro)
  assert.equal(read(pad({ pressed: [15], mapping: '' })).angle, null);
});

test('sin mando: sin rumbo ni disparo', () => {
  assert.deepEqual(read(null), { angle: null, fire: false });
});

test('snapAngle: redondea a N rumbos, o nada con 0', () => {
  assert.equal(PadInput.snapAngle(0.3, 8), 0);
  near(PadInput.snapAngle(0.5, 8), Math.PI / 4);
  assert.equal(PadInput.snapAngle(0.3, 0), 0.3);
});
