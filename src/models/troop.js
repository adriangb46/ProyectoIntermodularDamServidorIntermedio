import { randomUUID } from 'node:crypto';

/**
 * Representa una unidad individual de combate en el juego.
 * Mantiene el estado de salud y su ubicación (capital o desplegada).
 */
export class Troop {
  /**
   * @param {Object} data
   * @param {string} [data.id] - ID único de la instancia.
   * @param {string} data.typeId - Referencia al tipo de tropa (ej: 'frenzied_warrior').
   * @param {string} data.clanId - ID del clan al que pertenece.
   * @param {number} data.maxPoints - Salud o poder base máximo.
   * @param {number} [data.currentPoints] - Salud actual.
   */
  constructor({ id, typeId, clanId, maxPoints, currentPoints }) {
    this.id = id || randomUUID();
    this.typeId = typeId;
    this.clanId = clanId;
    this.maxPoints = maxPoints;
    this.currentPoints = currentPoints !== undefined ? currentPoints : maxPoints;
    
    // Estado de movilidad
    this.deployed = false;         // false = en capital (defensa), true = fuera
    this.travelTargetId = null;    // characterId del objetivo
    this.arrivalAt = null;         // Timestamp de llegada para resolución
  }

  /**
   * Prepara la tropa para un ataque.
   * @param {string} targetCharacterId - ID del personaje a atacar.
   * @param {number} arrivalTimestamp - Cuándo llegará al objetivo.
   */
  deploy(targetCharacterId, arrivalTimestamp) {
    this.deployed = true;
    this.travelTargetId = targetCharacterId;
    this.arrivalAt = arrivalTimestamp;
  }

  /**
   * Resetea la tropa a su estado en la capital.
   */
  returnHome() {
    this.deployed = false;
    this.travelTargetId = null;
    this.arrivalAt = null;
  }

  /**
   * Aplica daño a la tropa durante un combate.
   * @param {number} points - Puntos de daño a absorber.
   * @returns {number} El daño sobrante que la tropa no pudo absorber (si muere).
   */
  takeDamage(points) {
    const damageDealt = Math.min(this.currentPoints, points);
    this.currentPoints -= damageDealt;
    return points - damageDealt;  //pasa el daño a la siguiente tropa
  }

  /**
   * Indica si la tropa ha caído en combate.
   * @returns {boolean}
   */
  isDead() {
    return this.currentPoints <= 0;
  }

  /**
   * Serializa la tropa para persistencia o envío a cliente.
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      typeId: this.typeId,
      clanId: this.clanId,
      maxPoints: this.maxPoints,
      currentPoints: this.currentPoints,
      deployed: this.deployed,
      travelTargetId: this.travelTargetId,
      arrivalAt: this.arrivalAt
    };
  }
}
