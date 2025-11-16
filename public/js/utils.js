/**
 * Utilidades Generales
 * Funciones helper reutilizables para todo el proyecto
 */

/**
 * Interpolación lineal
 * @param {number} start - Valor inicial
 * @param {number} end - Valor final
 * @param {number} factor - Factor de interpolación (0-1)
 * @returns {number}
 */
export function lerp(start, end, factor) {
  return start + (end - start) * factor;
}

/**
 * Función de easing ease-out (cúbica)
 * @param {number} t - Progreso normalizado (0-1)
 * @returns {number}
 */
export function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Función de easing ease-in (cúbica)
 * @param {number} t - Progreso normalizado (0-1)
 * @returns {number}
 */
export function easeIn(t) {
  return t * t * t;
}

/**
 * Mostrar un elemento HTML
 * @param {HTMLElement} element - Elemento a mostrar
 */
export function showElement(element) {
  if (element) {
    element.classList.remove('hidden');
  }
}

/**
 * Ocultar un elemento HTML
 * @param {HTMLElement} element - Elemento a ocultar
 */
export function hideElement(element) {
  if (element) {
    element.classList.add('hidden');
  }
}

/**
 * Generar ID único
 * @returns {string}
 */
export function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Clamp un valor entre min y max
 * @param {number} value - Valor a limitar
 * @param {number} min - Valor mínimo
 * @param {number} max - Valor máximo
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Detectar si es un salto de portal (teletransportación)
 * @param {number} from - Posición origen
 * @param {number} to - Posición destino
 * @param {number} maxNormalMove - Máximo movimiento normal permitido
 * @returns {boolean}
 */
export function isPortalJump(from, to, maxNormalMove) {
  return Math.abs(to - from) > maxNormalMove;
}

/**
 * Formatear tiempo en formato MM:SS
 * @param {number} seconds - Segundos
 * @returns {string}
 */
export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Validar nombre de usuario
 * @param {string} username - Nombre a validar
 * @param {number} minLength - Longitud mínima
 * @param {number} maxLength - Longitud máxima
 * @returns {{valid: boolean, error: string}}
 */
export function validateUsername(username, minLength = 2, maxLength = 20) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'El nombre es requerido' };
  }

  const trimmed = username.trim();

  if (trimmed.length < minLength) {
    return { valid: false, error: `El nombre debe tener al menos ${minLength} caracteres` };
  }

  if (trimmed.length > maxLength) {
    return { valid: false, error: `El nombre no puede exceder ${maxLength} caracteres` };
  }

  return { valid: true, error: null };
}

/**
 * Validar ID de sala
 * @param {string} roomId - ID de sala a validar
 * @param {number} expectedLength - Longitud esperada
 * @returns {{valid: boolean, error: string}}
 */
export function validateRoomId(roomId, expectedLength = 6) {
  if (!roomId || typeof roomId !== 'string') {
    return { valid: false, error: 'ID de sala requerido' };
  }

  const trimmed = roomId.trim().toUpperCase();

  if (trimmed.length !== expectedLength) {
    return { valid: false, error: `ID de sala debe tener ${expectedLength} caracteres` };
  }

  return { valid: true, error: null };
}

/**
 * Calcular velocidad de interpolación basada en game speed
 * @param {number} gameSpeed - Velocidad del juego en ms
 * @returns {number}
 */
export function calculateInterpolationSpeed(gameSpeed, minSpeed = 25, maxSpeed = 200, minInterp = 0.08, maxInterp = 0.3) {
  const clampedSpeed = clamp(gameSpeed, minSpeed, maxSpeed);
  const normalizedSpeed = (clampedSpeed - minSpeed) / (maxSpeed - minSpeed);
  return maxInterp - (normalizedSpeed * (maxInterp - minInterp));
}

/**
 * Detectar si el navegador es móvil
 * @returns {boolean}
 */
export function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Debounce function
 * @param {Function} func - Función a ejecutar
 * @param {number} wait - Tiempo de espera en ms
 * @returns {Function}
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Truncar texto con ellipsis
 * @param {string} text - Texto a truncar
 * @param {number} maxLength - Longitud máxima
 * @returns {string}
 */
export function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 1) + '…';
}

export default {
  lerp,
  easeOut,
  easeIn,
  showElement,
  hideElement,
  generateId,
  clamp,
  isPortalJump,
  formatTime,
  validateUsername,
  validateRoomId,
  calculateInterpolationSpeed,
  isMobile,
  debounce,
  truncate,
};
