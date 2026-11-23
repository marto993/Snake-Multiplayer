/*
 * Mando (Gamepad API): traduce los ejes y botones de un mando a un rumbo y un disparo.
 * No lee el navegador: SnakeGame.js le pasa el mando de navigator.getGamepads() en cada cuadro.
 * También carga en Node, para las pruebas (test/pad.test.js).
 *
 *   PadInput.read(gamepad, out) -> out        out.angle: rumbo en radianes (y crece hacia abajo) o null
 *                                             out.fire: si el botón de disparo está apretado
 *   PadInput.snapAngle(angle, steps) -> angle redondea a `steps` rumbos (0: sin redondeo)
 *   PadInput.DEADZONE                         inclinación del stick por debajo de la cual no cuenta
 *
 * Con el mapeo estándar (Xbox, PlayStation y la mayoría de los genéricos): stick izquierdo
 * (ejes 0 y 1) o cruceta (botones 12 a 15) para el rumbo; A (botón 0) o gatillo derecho (7) para
 * disparar. Sin mapeo estándar, los índices de la cruceta cambian de un mando a otro: se usan solo
 * el primer par de ejes y cualquiera de los cuatro primeros botones.
 */
(function (global) {
  'use strict';

  const DEADZONE = 0.3;
  const TRIGGER = 0.5;   // un gatillo analógico dispara pasada la mitad del recorrido
  const STANDARD_FIRE = [0, 7];
  const GENERIC_FIRE = [0, 1, 2, 3];

  function pressed(buttons, i) {
    const b = buttons[i];
    return !!b && (b.pressed || b.value > TRIGGER);
  }

  function read(gp, out) {
    out.angle = null;
    out.fire = false;
    if (!gp) return out;
    const axes = gp.axes || [];
    const buttons = gp.buttons || [];
    const standard = gp.mapping === 'standard';
    const x = +axes[0] || 0, y = +axes[1] || 0;
    if (Math.sqrt(x * x + y * y) >= DEADZONE) {
      out.angle = Math.atan2(y, x);
    } else if (standard) {
      const dx = (pressed(buttons, 15) ? 1 : 0) - (pressed(buttons, 14) ? 1 : 0);
      const dy = (pressed(buttons, 13) ? 1 : 0) - (pressed(buttons, 12) ? 1 : 0);
      if (dx || dy) out.angle = Math.atan2(dy, dx);
    }
    const fire = standard ? STANDARD_FIRE : GENERIC_FIRE;
    for (let i = 0; i < fire.length; i++) if (pressed(buttons, fire[i])) { out.fire = true; break; }
    return out;
  }

  function snapAngle(angle, steps) {
    if (!steps) return angle;
    const unit = 2 * Math.PI / steps;
    return Math.round(angle / unit) * unit;
  }

  global.PadInput = { read: read, snapAngle: snapAngle, DEADZONE: DEADZONE };
})(typeof window !== 'undefined' ? window : this);
