/**
 * Representa una partida completa en el Middle Server.
 * Actúa como el contenedor principal del estado de juego y la cola de eventos asociados.
 */
export class Game {
  /**
   * @param {Object} data
   * @param {string} data.id - UUID de la partida.
   * @param {number} data.maxPlayers - Límite de participantes (2-6).
   */
  constructor({ id, maxPlayers }) {
    this.id = id;
    this.maxPlayers = maxPlayers;
    this.phase = 'waiting';      // Fases: waiting | preparation | war | end | finished
    this.startedAt = null;       // Timestamp de inicio real
    
    // Estado de los participantes indexado por characterId
    // Se usa un objeto plano para facilitar la serialización a JSONB en Postgres
    this.players = {};           // { [characterId]: Player }
    
    // Cola de eventos cronometrados (Time Wheel)
    // En una implementación real, esto podría ser un MinHeap para eficiencia
    this.eventQueue = [];
  }

  /**
   * Registra un nuevo jugador en la partida.
   * @param {import('./player').Player} player 
   */
  addPlayer(player) {
    const currentCount = Object.keys(this.players).length;
    if (currentCount >= this.maxPlayers) {
      throw new Error(`La partida ${this.id} ya está llena (${this.maxPlayers} jugadores)`);
    }
    this.players[player.characterId] = player;
  }

  /**
   * Recupera un jugador específico de la partida.
   * @param {string} characterId 
   * @returns {import('./player').Player|undefined}
   */
  getPlayer(characterId) {
    return this.players[characterId];
  }

  /**
   * Actualiza la fase de juego y registra el tiempo de inicio si corresponde.
   * @param {string} newPhase 
   */
  setPhase(newPhase) {
    this.phase = newPhase;
    if (newPhase === 'preparation' && !this.startedAt) {
      this.startedAt = Date.now();
    }
  }

  /**
   * Serializa el estado completo de la partida para su volcado a la DB Server.
   * No incluye funciones ni referencias circulares.
   * @returns {Object}
   */
  toJSON() {
    const playersSerialized = {};
    for (const [charId, player] of Object.entries(this.players)) {
      playersSerialized[charId] = (typeof player.toJSON === 'function') ? player.toJSON() : player;
    }

    return {
      id: this.id,
      maxPlayers: this.maxPlayers,
      phase: this.phase,
      startedAt: this.startedAt,
      players: playersSerialized,
      eventQueue: this.eventQueue
    };
  }
}
