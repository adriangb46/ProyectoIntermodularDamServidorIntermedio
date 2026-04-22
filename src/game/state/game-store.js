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
   * Limpia todas las partidas de memoria.
   * Uso principal en tests.
   */
  clear() {
    this.games.clear();
  }
}

// Exportar la instancia única
export const gameStore = new GameStore();
