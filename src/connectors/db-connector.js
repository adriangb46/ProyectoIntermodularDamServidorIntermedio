import { config } from '../config/index.js';

/**
 * Cliente REST para la comunicación con el DB Server (Spring Boot).
 * Utiliza fetch nativo (Node 18+) e incluye gestión de handshake.
 */
class DbConnector {
  constructor() {
    this.token = null;
    this.baseUrl = config.dbServerUrl;
  }

  /**
   * Realiza el handshake inicial con el DB server utilizando el secreto configurado.
   * Guarda el token JWT devuelto en memoria.
   * Incorpora lógica de reintentos con backoff exponencial para tolerar arranques lentos del DB server.
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

        console.log('✅ DB Server handshake successful.');
        return; // éxito → salimos del bucle

      } catch (error) {
        const isLastAttempt = attempt >= maxRetries;
        if (isLastAttempt) {
          console.error(`❌ Handshake fallido tras ${maxRetries} intentos: ${error.message}`);
          throw error;
        }
        console.warn(`⏳ Handshake intento ${attempt}/${maxRetries} fallido (${error.message}). Reintentando en ${delayMs / 1000}s...`);
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

  // --- Endpoints de Partidas ---

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
}

// Exportamos como singleton
export const dbConnector = new DbConnector();
