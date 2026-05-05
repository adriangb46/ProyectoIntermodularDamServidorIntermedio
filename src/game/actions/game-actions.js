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
 * Mueve la partida de la fase `waiting` a `preparation` y programa
 * la transición automática a `war` tras el período de preparación.
 *
 * Validaciones:
 *  - Solo el host (jugador con isHost === true) puede iniciar.
 *  - La partida debe estar en fase `waiting`.
 *  - Debe haber al menos 2 jugadores registrados en la partida.
 *
 * @param {import('../../models/game').Game} game                   - Partida activa.
 * @param {string}                           characterId            - characterId del jugador que solicita el inicio.
 * @param {import('../engine/time-wheel').TimeWheel} timeWheel      - Time Wheel para programar PHASE_TRANSITION_WAR.
 * @param {number}                           preparationDurationMs  - Milisegundos de la fase de preparación.
 * @returns {{ success: boolean, message?: string, warStartsAt?: number }}
 */
export function startGame(game, characterId, timeWheel, preparationDurationMs) {
  // 1. La partida debe estar en fase waiting
  if (game.phase !== 'waiting') {
    return { success: false, message: 'La partida ya ha sido iniciada o ha finalizado.' };
  }

  // 2. El solicitante debe ser participante de la partida
  const player = game.getPlayer(characterId);
  if (!player) {
    return { success: false, message: 'No eres participante de esta partida.' };
  }

  // 3. Solo el host puede iniciar la partida (security.md §5: autorización server-side)
  if (!player.isHost) {
    return { success: false, message: 'Solo el host de la partida puede iniciarla.' };
  }

  // 4. Validar número mínimo de jugadores (al menos 2 para que haya combate)
  const totalPlayers = Object.keys(game.players).length;
  if (totalPlayers < 2) {
    return {
      success: false,
      message: `Se necesitan al menos 2 jugadores para iniciar. Actualmente: ${totalPlayers}.`
    };
  }

  // 5. Transicionar a fase preparation (setPhase asigna startedAt y créditos iniciales)
  game.setPhase('preparation');

  // 6. Programar la transición automática a guerra en el Time Wheel
  const warStartsAt = Date.now() + preparationDurationMs;
  timeWheel.scheduleEvent(game.id, new GameEvent({
    gameId: game.id,
    type: 'PHASE_TRANSITION_WAR',
    executeAt: warStartsAt,
  }));

  const duracionMinutos = Math.round(preparationDurationMs / 60_000);
  console.log(
    `[GameActions] Partida ${game.id} iniciada por ${characterId}. ` +
    `Fase PREPARACIÓN → GUERRA en ${duracionMinutos} min (executeAt: ${warStartsAt}).`
  );

  return { success: true, warStartsAt };
}

/**
 * Añade una tropa a la cola de entrenamiento (Sprint 2 Logic).
 * Se incluye aquí como placeholder para el Dev B.
 */
export function trainTroop(game, characterId, troopTypeId, timeWheel) {
  // Lógica similar de validación...
  return { success: false, message: 'Acción de entrenamiento pendiente de implementación final.' };
}
