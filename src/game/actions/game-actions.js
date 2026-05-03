import { GameEvent } from '../../models/game-event.js';
import { gameData } from '../../config/game-data-loader.js';

/**
 * Lógica de negocio para las acciones de juego.
 * Todas las funciones deben validar el estado antes de aplicar cambios.
 */

/**
 * Inicia una investigación tecnológica para un jugador.
 * 
 * @param {import('../../models/game').Game} game - Partida activa.
 * @param {string} characterId - ID del personaje que investiga.
 * @param {string} researchId - ID de la tecnología a investigar.
 * @param {import('../engine/time-wheel').TimeWheel} timeWheel - Referencia para programar el evento.
 * @returns {Object} Resultado de la acción { success: boolean, message?: string }
 */
export function startResearch(game, characterId, researchId, timeWheel) {
  // 1. Validar fase de la partida
  if (!['preparation', 'war'].includes(game.phase)) {
    return { success: false, message: 'No se puede investigar en esta fase de la partida.' };
  }

  const player = game.getPlayer(characterId);
  if (!player || player.eliminated) {
    return { success: false, message: 'Jugador no encontrado o eliminado.' };
  }

  // 2. Validar que no haya otra investigación en curso
  if (player.researchInProgress) {
    return { success: false, message: 'Ya hay una investigación en curso.' };
  }

  // 3. Obtener datos de la tecnología desde el clan del jugador
  const clan = gameData[player.clanId];
  if (!clan) {
    return { success: false, message: 'Datos del clan no encontrados.' };
  }

  const tech = clan.technologies.find(t => t.id === researchId);
  if (!tech) {
    return { success: false, message: 'Tecnología no encontrada para este clan.' };
  }

  // 4. Validar que no esté ya desbloqueada
  if (player.unlockedResearches.includes(researchId)) {
    return { success: false, message: 'Esta tecnología ya ha sido desbloqueada.' };
  }

  // 5. Validar prerrequisitos
  if (tech.requirements && tech.requirements.length > 0) {
    const missingReq = tech.requirements.find(reqId => !player.unlockedResearches.includes(reqId));
    if (missingReq) {
      return { success: false, message: 'No cumples los prerrequisitos para esta investigación.' };
    }
  }

  // 6. Validar recursos (Research Credits / Sabiduría)
  if (player.researchCredits < tech.researchCost) {
    return { success: false, message: 'Créditos de investigación insuficientes.' };
  }

  // 7. Aplicar cambios y programar evento
  player.researchCredits -= tech.researchCost;
  
  const now = Date.now();
  const completesAt = now + (tech.durationSeconds * 1000);
  
  player.researchInProgress = {
    researchId,
    completesAt
  };

  // Encolar en el Time Wheel
  timeWheel.scheduleEvent(game.id, new GameEvent({
    gameId: game.id,
    type: 'RESEARCH_COMPLETE',
    executeAt: completesAt,
    payload: { characterId, researchId }
  }));

  console.log(`[GameActions] ${characterId} inicia investigación: ${researchId}. Completa en ${tech.durationSeconds}s.`);

  return { success: true };
}

/**
 * Añade una tropa a la cola de entrenamiento (Sprint 2 Logic).
 * Se incluye aquí como placeholder para el Dev B.
 */
export function trainTroop(game, characterId, troopTypeId, timeWheel) {
  // Lógica similar de validación...
  return { success: false, message: 'Acción de entrenamiento pendiente de implementación final.' };
}
