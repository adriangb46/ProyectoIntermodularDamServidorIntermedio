/**
 * Módulo de Niebla de Guerra (Fog of War).
 *
 * Responsabilidad única: dada la partida completa y el characterId del observador,
 * devuelve una "vista" filtrada del estado que ese jugador tiene permiso de ver.
 *
 * Reglas de visibilidad:
 *   - Datos propios     → se envían íntegros (salvo campos puramente internos).
 *   - Datos de rivales  → se censuran los campos tácticos (créditos, cola, investigación).
 *   - Tropas propias    → se envían al completo (incluyendo las desplegadas).
 *   - Tropas rivales    → solo un sumario de las que están en su capital
 *                          (typeId visible, sin IDs individuales ni currentPoints).
 *                          Las tropas desplegadas del rival son invisibles.
 *   - connectedSocketId → nunca se envía al cliente (dato interno de infraestructura).
 *   - userId            → nunca se envía al cliente (dato de autenticación interna).
 */

/**
 * Construye la vista filtrada de la partida para un jugador concreto.
 *
 * @param {import('../../models/game').Game} game                  - Instancia completa de la partida.
 * @param {string}                           viewerCharacterId     - characterId del jugador receptor del evento.
 * @returns {Object} Vista censurada de la partida apta para ser enviada al cliente.
 */
export function buildGameView(game, viewerCharacterId) {
  // Cabecera pública: campos que todos los jugadores ven por igual
  const view = {
    id:         game.id,
    phase:      game.phase,
    startedAt:  game.startedAt,
    maxPlayers: game.maxPlayers,
    players:    {},
  };

  for (const [charId, player] of Object.entries(game.players)) {
    if (charId === viewerCharacterId) {
      // -----------------------------------------------------------------------
      // Vista propia: datos completos (excepto campos puramente internos)
      // -----------------------------------------------------------------------
      view.players[charId] = _buildSelfView(player);
    } else {
      // -----------------------------------------------------------------------
      // Vista rival: datos censurados según las reglas de Fog of War
      // -----------------------------------------------------------------------
      view.players[charId] = _buildRivalView(player);
    }
  }

  return view;
}

// -----------------------------------------------------------------------------
// Funciones auxiliares privadas
// -----------------------------------------------------------------------------

/**
 * Construye la vista completa del jugador para sí mismo.
 * Se omiten `connectedSocketId` y `userId` porque son datos internos de infraestructura
 * que el cliente nunca necesita.
 *
 * @param {import('../../models/player').Player} player
 * @returns {Object}
 */
function _buildSelfView(player) {
  return {
    characterId:       player.characterId,
    clanId:            player.clanId,
    isHost:            player.isHost,
    capitalHealth:     player.capitalHealth,
    eliminated:        player.eliminated,
    // Recursos propios (visibles solo para el propietario)
    economicCredits:   player.economicCredits,
    researchCredits:   player.researchCredits,
    // Actividad propia (visibles solo para el propietario)
    researchInProgress: player.researchInProgress,
    trainingQueue:     player.trainingQueue,
    unlockedResearches: player.unlockedResearches,
    // Tropas propias: se envían al completo (en capital y desplegadas)
    troops: player.troops.map(t =>
      typeof t.toJSON === 'function' ? t.toJSON() : t
    ),
  };
}

/**
 * Construye la vista censurada de un jugador rival.
 * Se ocultan los datos tácticos y se sustituye el array de tropas por un sumario
 * únicamente de las unidades que están en la capital (no desplegadas).
 *
 * @param {import('../../models/player').Player} player
 * @returns {Object}
 */
function _buildRivalView(player) {
  // Solo las tropas que están en la capital del rival son visibles (y solo su tipo, no sus stats)
  const troopsInCapital = player.troops.filter(t => !t.deployed && t.currentPoints > 0);

  return {
    characterId:   player.characterId,
    clanId:        player.clanId,
    isHost:        player.isHost,
    capitalHealth: player.capitalHealth,
    eliminated:    player.eliminated,
    // Sumario de tropas en capital: cuántas hay y de qué tipo, sin IDs ni currentPoints
    troopSummary: {
      count: troopsInCapital.length,
      types: troopsInCapital.map(t => t.typeId),
    },
    // Campos tácticos omitidos intencionadamente (Fog of War):
    //   economicCredits, researchCredits, researchInProgress,
    //   trainingQueue, unlockedResearches
    // Tropas desplegadas del rival: completamente invisibles (se notifican via game:troop-deployed)
  };
}
