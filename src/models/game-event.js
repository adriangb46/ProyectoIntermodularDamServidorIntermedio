import { randomUUID } from 'node:crypto';

/**
 * Representa una tarea o suceso programado en el futuro dentro de una partida.
 * Estos eventos son consumidos por el Time Wheel (scheduler central).
 */
export class GameEvent {
  /**
   * @param {Object} data
   * @param {string} [data.id] - ID único del evento (se genera si no existe).
   * @param {string} data.gameId - Referencia a la partida que posee el evento.
   * @param {string} data.type - Tipo de evento (ej: 'TROOP_ARRIVAL', 'PHASE_TRANSITION').
   * @param {number} data.executeAt - Timestamp (ms) en el que debe procesarse el evento.
   * @param {Object} [data.payload] - Datos específicos necesarios para ejecutar la acción.
   */
  constructor({ id, gameId, type, executeAt, payload = {} }) {
    this.id = id || randomUUID();
    this.gameId = gameId;
    this.type = type;
    this.executeAt = executeAt;
    this.payload = payload;
  }

  /**
   * Verifica si el evento está listo para ser procesado dado un tiempo actual.
   * @param {number} now - Timestamp actual en milisegundos.
   * @returns {boolean}
   */
  isDue(now) {
    return this.executeAt <= now;
  }

  /**
   * Serializa el evento para persistencia.
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      gameId: this.gameId,
      type: this.type,
      executeAt: this.executeAt,
      payload: this.payload
    };
  }
}
