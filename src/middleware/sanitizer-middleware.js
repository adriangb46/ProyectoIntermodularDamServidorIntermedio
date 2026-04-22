const { sanitizeInput } = require('../utils/sanitizer');

/**
 * Middleware para Express que sanitiza automáticamente req.body, req.query y req.params.
 */
function sanitizerMiddleware(req, res, next) {
  if (req.body) {
    req.body = sanitizeInput(req.body);
  }
  if (req.query) {
    req.query = sanitizeInput(req.query);
  }
  if (req.params) {
    req.params = sanitizeInput(req.params);
  }
  next();
}

module.exports = sanitizerMiddleware;
