import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisConnector } from '../connectors/redis-connector.js';
import { config } from '../config/index.js';

/**
 * Factoría de rate limiters con store de Redis.
 * Usar Redis como store permite compartir contadores entre múltiples instancias
 * del Middle Server, y sobrevive a reinicios del proceso.
 *
 * Cumple con security.md §3: "Rate limit login attempts via Redis".
 *
 * @param {object} options - Configuración del limitador
 * @param {string} options.prefix - Prefijo para las claves en Redis
 * @param {number} options.windowMs - Ventana de tiempo en milisegundos
 * @param {number} options.max - Número máximo de peticiones por ventana
 * @param {string} options.message - Mensaje de error para el cliente
 * @returns {import('express-rate-limit').RateLimitRequestHandler}
 */
function createRateLimiter({ prefix, windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,  // Devuelve info de rate limit en headers `RateLimit-*`
    legacyHeaders: false,   // Deshabilita los headers `X-RateLimit-*` obsoletos
    message: { message },
    // Usamos Redis como store para persistencia y escalabilidad
    store: new RedisStore({
      // sendCommand es la interfaz que rate-limit-redis espera
      sendCommand: async (...args) => {
        await redisConnector.connect();
        return redisConnector.client.sendCommand(args);
      },
      prefix: `rl:${prefix}:`,
    }),
    // Identificador: IP del cliente (default: req.ip)
    // El default es seguro para IPv6 y compatible con proxies si se configura trust proxy
  });
}

/**
 * Rate limiter para el endpoint de Login.
 * 20 intentos / 15 minutos por IP (security.md §3).
 */
export const loginLimiter = createRateLimiter({
  prefix: 'login',
  windowMs: config.rateLimitLoginWindowMs,
  max: config.rateLimitLoginMax,
  message: 'Demasiados intentos de login. Inténtalo de nuevo más tarde.',
});

/**
 * Rate limiter para el endpoint de Registro.
 * 10 intentos / 60 minutos por IP.
 */
export const registerLimiter = createRateLimiter({
  prefix: 'register',
  windowMs: config.rateLimitRegisterWindowMs,
  max: config.rateLimitRegisterMax,
  message: 'Demasiados intentos de registro. Inténtalo de nuevo más tarde.',
});

/**
 * Rate limiter para el evento Socket.IO join_game.
 * Como express-rate-limit no aplica directamente a sockets,
 * este se implementa como verificación manual usando Redis INCR+EXPIRE.
 *
 * 40 intentos / 1 minuto por IP.
 */
export async function checkJoinGameRateLimit(socketIp) {
  try {
    await redisConnector.connect();
    const key = `rl:joingame:${socketIp}`;
    const current = await redisConnector.client.incr(key);

    // Si es la primera petición en la ventana, establecer TTL
    if (current === 1) {
      const windowSeconds = Math.ceil(config.rateLimitJoinGameWindowMs / 1000);
      await redisConnector.client.expire(key, windowSeconds);
    }

    if (current > config.rateLimitJoinGameMax) {
      console.warn(`[RateLimit] join_game bloqueado para IP ${socketIp} (${current}/${config.rateLimitJoinGameMax})`);
      return false; // Bloqueado
    }

    return true; // Permitido
  } catch (error) {
    // Fail-open: si Redis falla, permitimos la petición para no bloquear el servicio
    console.error('[RateLimit] Error al comprobar rate limit de join_game:', error.message);
    return true;
  }
}
