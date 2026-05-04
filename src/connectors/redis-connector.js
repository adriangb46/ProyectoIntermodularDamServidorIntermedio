import { createClient } from 'redis';
import { config } from '../config/index.js';

/**
 * Conector de Redis para la Middle Server.
 * Gestiona la conexión y las operaciones de la lista negra (blacklist) de JWT.
 */
class RedisConnector {
  constructor() {
    this.client = createClient({
      url: config.redisUrl
    });

    this.client.on('error', (err) => console.error('[Redis] Error en el cliente:', err));
    this.client.on('connect', () => console.log('[Redis] Conectado correctamente.'));
  }

  /**
   * Inicializa la conexión con Redis.
   */
  async connect() {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  /**
   * Añade un JTI a la lista negra con un tiempo de expiración.
   * @param {string} jti - El ID del JWT.
   * @param {number} ttlSeconds - Tiempo de vida en segundos (hasta que el token expire naturalmente).
   */
  async blacklist(jti, ttlSeconds) {
    if (!jti) return;
    try {
      await this.connect();
      // Usamos un prefijo para evitar colisiones de claves
      const key = `blacklist:${jti}`;
      // Guardamos un valor arbitrario ('1') con el TTL especificado
      await this.client.set(key, '1', {
        EX: ttlSeconds
      });
      console.log(`[Redis] JTI blacklisted: ${jti} (TTL: ${ttlSeconds}s)`);
    } catch (error) {
      console.error(`[Redis] Error al añadir a blacklist ${jti}:`, error);
    }
  }

  /**
   * Comprueba si un JTI está en la lista negra.
   * @param {string} jti - El ID del JWT.
   * @returns {Promise<boolean>}
   */
  async isBlacklisted(jti) {
    if (!jti) return false;
    try {
      await this.connect();
      const exists = await this.client.exists(`blacklist:${jti}`);
      return exists === 1;
    } catch (error) {
      console.error(`[Redis] Error al comprobar blacklist para ${jti}:`, error);
      // En caso de error de Redis, por seguridad podríamos denegar, 
      // pero aquí optamos por permitir (fail-open) para no bloquear el servicio 
      // si Redis cae temporalmente, a menos que la política de seguridad sea estricta.
      return false;
    }
  }
}

export const redisConnector = new RedisConnector();
