/**
 * Representa el estado dinámico de un jugador (personaje) dentro de una partida activa.
 * Gestiona sus recursos, tropas, investigaciones y salud de la capital.
 */
export class Player {
  /**
   * @param {Object}  data
   * @param {string}  data.characterId  - ID del personaje.
   * @param {string}  data.userId       - ID del usuario.
   * @param {string}  data.username     - Nombre del usuario.
   * @param {string}  data.clanId       - ID del clan (ej: 'berserkers').
   * @param {number}  data.capitalHealth - Salud inicial de la capital.
   * @param {boolean} [data.isHost]     - Indica si este jugador es el creador/host de la partida.
   */
  constructor({ characterId, userId, username, clanId, capitalHealth, isHost = false }) {
    this.characterId = characterId;
    // Marca si este jugador es el host (único autorizado a iniciar la partida)
    this.isHost = isHost;
    this.userId = userId;
    this.username = username;
    this.clanId = clanId;
    
    // Recursos iniciales (se ajustan según la fase de preparación)
    this.economicCredits = 0;
    this.researchCredits = 0;
    
    // Estado vital
    this.capitalHealth = capitalHealth;
    this.eliminated = false;
    
    // Conectividad
    this.connectedSocketId = null;  //pregunatr si metemos un socket por partida o por usuario.
    
    // Pertenencias
    this.troops = [];             // Array de instancias de la clase Troop
    this.unlockedResearches = []; // IDs de investigaciones completadas
    
    // Actividad actual
    this.researchInProgress = null; // { researchId, completesAt }
    this.trainingQueue = [];        // [{ trainingId, troopTypeId, completesAt }]

    // Estadísticas por partida
    this.stats = {
      totalEconomicCreditsEarned: 0,
      totalResearchCreditsEarned: 0,
      totalTroopsTrained: 0,
      totalAttacksLaunched: 0,
      totalDamageDealt: 0,
      totalDamageReceived: 0,
      totalTroopsLost: 0,
      totalTroopsDeployed: 0,
      timePlayedMs: 0,
    };
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
      username: this.username,
      clanId: this.clanId,
      isHost: this.isHost,
      economicCredits: this.economicCredits,
      researchCredits: this.researchCredits,
      capitalHealth: this.capitalHealth,
      eliminated: this.eliminated,
      connectedSocketId: this.connectedSocketId,
      unlockedResearches: this.unlockedResearches,
      researchInProgress: this.researchInProgress,
      trainingQueue: this.trainingQueue,
      stats: this.stats,
      troops: this.troops.map(t => (typeof t.toJSON === 'function' ? t.toJSON() : t))
    };
  }
}
