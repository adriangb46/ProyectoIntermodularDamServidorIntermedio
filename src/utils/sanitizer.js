/**
 * Sanitiza un valor individual si es un string.
 * Implementación manual para evitar dependencias externas ante restricciones de red.
 * @param {any} value - Valor a sanitizar.
 * @returns {any} - Valor sanitizado.
 */
function sanitizeValue(value) {
  if (typeof value === 'string') {
    let sanitized = value.trim();
    // Escape básico de HTML para prevenir XSS
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
    return sanitized;
  }
  return value;
}

/**
 * Recorre un objeto (o array) recursivamente y sanitiza todos sus campos string.
 * @param {any} input - Objeto o array a sanitizar.
 * @returns {any} - Objeto/array con los strings sanitizados.
 */
function sanitizeInput(input) {
  if (input === null || input === undefined) return input;

  if (Array.isArray(input)) {
    return input.map(item => sanitizeInput(item));
  }

  if (typeof input === 'object' && !(input instanceof Date)) {
    const sanitizedObj = {};
    for (const [key, value] of Object.entries(input)) {
      sanitizedObj[key] = sanitizeInput(value);
    }
    return sanitizedObj;
  }

  return sanitizeValue(input);
}

module.exports = {
  sanitizeInput,
  sanitizeValue
};
