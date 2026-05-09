import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/** Margen de seguridad en ms para renovar el token ANTES de que expire (5 minutos). */
const RENEWAL_MARGIN_MS = 5 * 60 * 1000;

/**
 * Cliente REST para la comunicación con el DB Server (Spring Boot).
 * Utiliza fetch nativo (Node 18+) e incluye gestión de handshake y
 * renovación proactiva del JWT antes de su expiración.
 */
class DbConnector {
  constructor() {
    this.token = null;
    this.baseUrl = config.dbServerUrl;
    /** @type {NodeJS.Timeout | null} Timer de renovación proactiva del token. */
    this._renewalTimer = null;
  }

  /**
   * Decodifica el payload del JWT (sin verificar firma, solo para leer claims).
   * Es seguro en este contexto porque el token viene del DB Server de confianza.
   * @param {string} token
   * @returns {{ exp?: number } | null}
   */
  _decodeJwtPayload(token) {
    try {
      const payloadB64 = token.split('.')[1];
      // El payload del JWT usa base64url; reemplazamos los caracteres no estándar
      const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf-8');
      return JSON.parse(payloadJson);
    } catch {
      return null;
    }
  }

  /**
   * Programa la renovación proactiva del token basándose en el claim `exp`.
   * El timer se lanza RENEWAL_MARGIN_MS antes de la expiración.
   * Cancela cualquier timer previo antes de crear uno nuevo.
   * @param {string} token - El JWT recién recibido.
   */
  _scheduleTokenRenewal(token) {
    // Cancelar renovación previa si existía
    if (this._renewalTimer) {
      clearTimeout(this._renewalTimer);
      this._renewalTimer = null;
    }

    const payload = this._decodeJwtPayload(token);
    if (!payload?.exp) {
      logger.warn('[DbConnector] El token no contiene claim exp; se omite la renovación proactiva.');
      return;
    }

    // exp en JWT es en segundos; convertimos a ms
    const expiresAtMs = payload.exp * 1000;
    const renewInMs = expiresAtMs - Date.now() - RENEWAL_MARGIN_MS;

    if (renewInMs <= 0) {
      // El token ya está muy próximo a expirar; renovamos inmediatamente
      logger.warn('[DbConnector] Token próximo a expirar. Renovando handshake de inmediato.');
      this.performHandshake(3, 1000).catch(err =>
        logger.error({ err: err.message }, '[DbConnector] Error en renovación proactiva inmediata')
      );
      return;
    }

    logger.debug({ renewInMs }, '[DbConnector] Renovación proactiva del token programada.');
    this._renewalTimer = setTimeout(() => {
      logger.info('[DbConnector] Renovando token proactivamente antes de su expiración.');
      this.performHandshake(3, 1000).catch(err =>
        logger.error({ err: err.message }, '[DbConnector] Error en renovación proactiva')
      );
    }, renewInMs);
  }

  /**
   * Realiza el handshake con el DB server utilizando el secreto configurado.
   * Guarda el token JWT devuelto en memoria y programa su renovación proactiva.
   * Incorpora lógica de reintentos con backoff exponencial para tolerar arranques lentos.
   * @param {number} maxRetries - Número máximo de reintentos (por defecto 10)
   * @param {number} initialDelayMs - Tiempo de espera inicial en ms (por defecto 3000)
   */
  async performHandshake(maxRetries = 10, initialDelayMs = 3000) {
    if (!config.dbHandshakeToken) {
      throw new Error('No dbHandshakeToken configured in environment (DB_HANDSHAKE_SECRET or DB_HANDSHAKE_TOKEN missing).');
    }

    let attempt = 0;
    let delayMs = initialDelayMs;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const response = await fetch(`${this.baseUrl}/internal/auth/handshake`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ secret: config.dbHandshakeToken })
        });

        if (!response.ok) {
          throw new Error(`Handshake failed with status: ${response.status}`);
        }

        const responseBody = await response.json();

        // Asume que la respuesta exitosa viene en un envoltorio tipo { data: { token: '...' } }
        // O directamente { token: '...' }
        if (responseBody?.data?.token) {
          this.token = responseBody.data.token;
        } else if (responseBody?.token) {
          this.token = responseBody.token;
        } else {
          throw new Error('Token not found in handshake response.');
        }

        logger.info('✅ DB Server handshake successful.');
        // Programar la renovación proactiva del token
        this._scheduleTokenRenewal(this.token);
        return; // éxito → salimos del bucle

      } catch (error) {
        const isLastAttempt = attempt >= maxRetries;
        if (isLastAttempt) {
          logger.error({ err: error.message, maxRetries }, '❌ Handshake fallido tras máximos intentos');
          throw error;
        }
        logger.warn({ attempt, maxRetries, err: error.message, delayMs }, '⏳ Handshake fallido. Reintentando...');
        await new Promise(resolve => setTimeout(resolve, delayMs));
        // Backoff exponencial con techo en 30s
        delayMs = Math.min(delayMs * 2, 30_000);
      }
    }
  }

  /**
   * Wrapper genérico para fetch que inyecta el token de autorización.
   * @param {string} endpoint - El endpoint (ej. '/internal/users')
   * @param {RequestInit} options - Opciones de fetch
   * @returns {Promise<any>}
   */
  async fetchWithAuth(endpoint, options = {}) {
    if (!this.token) {
      await this.performHandshake();
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.token}`);
    
    // Si no es FormData y no hay Content-Type definido, asumimos JSON
    if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    let fetchOptions = { ...options, headers };
    let response = await fetch(url, fetchOptions);

    if (response.status === 401) {
      logger.warn('Token rechazado por el DB Server (401). Renovando handshake y reintentando...');
      await this.performHandshake(3, 1000); // Reintento corto
      headers.set('Authorization', `Bearer ${this.token}`);
      fetchOptions = { ...options, headers };
      response = await fetch(url, fetchOptions);
    }

    if (!response.ok) {
      let errorMsg = `Request failed with status ${response.status}`;
      try {
        const errData = await response.json();
        // Si el DB server usa el formato { message: '...' } para errores
        if (errData && errData.message) {
          errorMsg = errData.message;
        }
      } catch (e) {
        // Ignoramos errores de parseo si no hay JSON
      }
      
      const error = new Error(errorMsg);
      error.status = response.status;
      throw error;
    }

    // Retornamos null para 204 No Content
    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  // --- Endpoints de Usuarios ---

  async createUser(dto) {
    return this.fetchWithAuth('/internal/users', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  async getUser(id) {
    return this.fetchWithAuth(`/internal/users/${id}`, {
      method: 'GET',
    });
  }

  async getUserByUsername(username) {
    return this.fetchWithAuth(`/internal/users/by-username/${encodeURIComponent(username)}`, {
      method: 'GET',
    });
  }

  async verifyCredentials(username, password) {
    return this.fetchWithAuth('/internal/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  async updateAvatar(id, avatarUrl) {
    return this.fetchWithAuth(`/internal/users/${id}/avatar`, {
      method: 'PUT',
      body: JSON.stringify({ avatarUrl }),
    });
  }

  async changePassword(id, currentPassword, newPassword) {
    return this.fetchWithAuth(`/internal/users/${id}/password`, {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async updateEmail(id, email) {
    return this.fetchWithAuth(`/internal/users/${id}/email`, {
      method: 'PUT',
      body: JSON.stringify({ email }),
    });
  }

  // --- Endpoints de Personajes ---

  async getCharactersByUser(userId) {
    return this.fetchWithAuth(`/internal/characters/by-user/${userId}`, {
      method: 'GET',
    });
  }

  async createCharacter(dto) {
    return this.fetchWithAuth('/internal/characters', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  // --- Endpoints de Partidas ---

  async getGamesByUser(userId) {
    return this.fetchWithAuth(`/internal/games/by-user/${userId}`, {
      method: 'GET',
    });
  }

  async createGame(dto) {
    return this.fetchWithAuth('/internal/games', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  async getActiveGames() {
    return this.fetchWithAuth('/internal/games/active', {
      method: 'GET',
    });
  }

  async getGame(id) {
    return this.fetchWithAuth(`/internal/games/${id}`, {
      method: 'GET',
    });
  }

  async dumpState(id, stateDto) {
    return this.fetchWithAuth(`/internal/games/${id}/dump`, {
      method: 'PUT',
      body: JSON.stringify({ stateJson: JSON.stringify(stateDto) }),
    });
  }

  async endGame(id, dto) {
    return this.fetchWithAuth(`/internal/games/${id}/end`, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  async joinGame(gameId, characterId) {
    return this.fetchWithAuth(`/internal/games/${gameId}/join`, {
      method: 'POST',
      body: JSON.stringify(characterId),
    });
  }

  async publishAnalyticsSnapshot(snapshotDto) {
    return this.fetchWithAuth('/internal/analytics/snapshots', {
      method: 'POST',
      body: JSON.stringify(snapshotDto),
    });
  }

  async getAdminStats() {
    return this.fetchWithAuth('/internal/admin/stats', {
      method: 'GET',
    });
  }

  async getAllUsers() {
    return this.fetchWithAuth('/internal/admin/users', {
      method: 'GET',
    });
  }

  async banUser(userId) {
    return this.fetchWithAuth(`/internal/admin/users/${userId}/ban`, {
      method: 'PUT',
    });
  }

  async unbanUser(userId) {
    return this.fetchWithAuth(`/internal/admin/users/${userId}/unban`, {
      method: 'PUT',
    });
  }

  async getUserStats(userId) {
    return this.fetchWithAuth(`/internal/analytics/user/${userId}`, {
      method: 'GET',
    });
  }
}

// Exportamos como singleton
export const dbConnector = new DbConnector();
