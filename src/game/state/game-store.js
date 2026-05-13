/**
 * Almacén centralizado de todas las partidas activas en memoria.
 * Implementa un patrón Singleton para garantizar que todo el servidor
 * acceda a la misma fuente de verdad para el estado de los juegos.
 */
class GameStore {
  constructor() {
    /** 
     * Mapa de partidas indexado por gameId.
     * @type {Map<string, import('../../models/game').Game>} 
     */
    this.games = new Map();

    /**
     * Log de partidas finalizadas para métricas (ID y timestamp).
     * @type {{id: string, finishedAt: number}[]}
     */
    this.finishedGamesLog = [];
  }

  /**
   * Añade una instancia de partida al almacén.
   * @param {import('../../models/game').Game} game 
   */
  addGame(game) {
    this.games.set(game.id, game);
  }

  /**
   * Busca una partida activa por su identificador.
   * @param {string} id - UUID de la partida.
   * @returns {import('../../models/game').Game | undefined}
   */
  getGame(id) {
    return this.games.get(id);
  }

  /**
   * Busca una partida por el código corto (primeros 6 caracteres del UUID).
   * @param {string} shortId - Código de 6 caracteres.
   * @returns {import('../../models/game').Game | undefined}
   */
  getGameByShortId(shortId) {
    if (!shortId) return undefined;
    if (shortId.length > 6) return this.getGame(shortId);
    
    const normalizedShortId = shortId.toUpperCase();
    return Array.from(this.games.values()).find(g => 
      g.id.substring(0, 6).toUpperCase() === normalizedShortId
    );
  }

  /**
   * Elimina una partida de la memoria.
   * Se debe llamar cuando una partida finaliza o es purgada.
   * @param {string} id 
   */
  removeGame(id) {
    this.games.delete(id);
  }

  /**
   * Retorna un array con todas las partidas en curso.
   * Útil para el Time Wheel o procesos de volcado masivo.
   * @returns {import('../../models/game').Game[]}
   */
  getAll() {
    return Array.from(this.games.values());
  }

  /**
   * Devuelve el número total de partidas gestionadas actualmente.
   * @returns {number}
   */
  count() {
    return this.games.size;
  }

  /**
   * Registra una partida como finalizada para métricas de administración.
   * @param {string} id 
   */
  recordFinishedGame(id) {
    this.finishedGamesLog.push({ id, finishedAt: Date.now() });
    // Mantener solo la última hora para no saturar memoria
    this._cleanupFinishedLog();
  }

  /**
   * Cuenta cuántas partidas han finalizado en los últimos 60 minutos.
   * @returns {number}
   */
  countFinishedGamesInLastHour() {
    this._cleanupFinishedLog();
    return this.finishedGamesLog.length;
  }

  /**
   * Elimina registros de partidas finalizadas hace más de una hora.
   * @private
   */
  _cleanupFinishedLog() {
    const oneHourAgo = Date.now() - 3600000;
    this.finishedGamesLog = this.finishedGamesLog.filter(g => g.finishedAt > oneHourAgo);
  }

  /**
   * Limpia todas las partidas de memoria.
   * Uso principal en tests.
   */
  clear() {
    this.games.clear();
    this.finishedGamesLog = [];
  }
}

// Exportar la instancia única
export const gameStore = new GameStore();