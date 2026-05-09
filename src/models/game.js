import { config } from '../config/index.js';

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
    this.maxPlayers = maxPlayers; //revisar pasar a constante.
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
    
    // Si es el primer jugador en entrar, aseguramos que sea host por si acaso
    if (Object.keys(this.players).length === 1) {
      player.isHost = true;
    }
  }

  /**
   * Elimina un jugador de la partida (usado en fase waiting o por abandono).
   * Si el jugador era el host, transfiere el host al siguiente disponible.
   * @param {string} characterId 
   */
  removePlayer(characterId) {
    const player = this.players[characterId];
    if (!player) return;

    const wasHost = player.isHost;
    delete this.players[characterId];

    // Si la partida no está vacía y el que salió era el host, asignamos uno nuevo
    if (wasHost) {
      const remainingPlayers = Object.values(this.players);
      if (remainingPlayers.length > 0) {
        remainingPlayers[0].isHost = true;
      }
    }
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
      this.startedAt = Date.now();  // se guarda en memoria el momento de comienzo de la partida
      
      // Asignar recursos iniciales a todos los jugadores (100% del máximo)
      for (const player of Object.values(this.players)) {
        player.economicCredits = config.maxEconomicCredits;
        player.researchCredits = config.maxResearchCredits;
      }
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
      phase: this.phase.toUpperCase(),
      startedAt: this.startedAt,
      players: playersSerialized,
      eventQueue: this.eventQueue
    };
  }
}
