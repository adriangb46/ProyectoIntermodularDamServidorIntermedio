/**
 * Representa el estado dinámico de un jugador (personaje) dentro de una partida activa.
 * Gestiona sus recursos, tropas, investigaciones y salud de la capital.
 */
export class Player {
  /**
   * @param {Object} data
   * @param {string} data.characterId - ID del personaje.
   * @param {string} data.userId - ID del usuario.
   * @param {string} data.clanId - ID del clan (ej: 'berserkers').
   * @param {number} data.capitalHealth - Salud inicial de la capital.
   */
  constructor({ characterId, userId, clanId, capitalHealth }) {
    this.characterId = characterId;
    this.userId = userId;
    this.clanId = clanId;
    
    // Recursos iniciales (se ajustan según la fase de preparación)
    this.economicCredits = 0;
    this.researchCredits = 0;
    
    // Estado vital
    this.capitalHealth = capitalHealth;
    this.eliminated = false;
    
    // Conectividad
    this.connectedSocketId = null;
    
    // Pertenencias
    this.troops = [];             // Array de instancias de la clase Troop
    this.unlockedResearches = []; // IDs de investigaciones completadas
    
    // Actividad actual
    this.researchInProgress = null; // { researchId, completesAt }
  }

  /**
   * Añade una instancia de tropa a la colección del jugador.
   * @param {import('./troop').Troop} troop 
   */
  addTroop(troop) {
    this.troops.push(troop);
  }

  /**
   * Elimina permanentemente las tropas con salud <= 0.
   */
  cleanupDeadTroops() {
    this.troops = this.troops.filter(t => t.currentPoints > 0);
  }

  /**
   * Retorna las tropas que están actualmente en la capital y pueden defender.
   */
  getDefendingTroops() {
    return this.troops.filter(t => !t.deployed && t.currentPoints > 0);
  }

  /**
   * Calcula la suma total de puntos de poder de las tropas en la capital.
   */
  getTotalDefensePower() {
    return this.getDefendingTroops().reduce((sum, t) => sum + t.currentPoints, 0);
  }

  /**
   * Serializa el estado del jugador para persistencia en base de datos.
   * @returns {Object}
   */
  toJSON() {
    return {
      characterId: this.characterId,
      userId: this.userId,
      clanId: this.clanId,
      economicCredits: this.economicCredits,
      researchCredits: this.researchCredits,
      capitalHealth: this.capitalHealth,
      eliminated: this.eliminated,
      connectedSocketId: this.connectedSocketId,
      unlockedResearches: this.unlockedResearches,
      researchInProgress: this.researchInProgress,
      troops: this.troops.map(t => (typeof t.toJSON === 'function' ? t.toJSON() : t))
    };
  }
}
