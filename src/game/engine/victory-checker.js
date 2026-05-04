import { dbConnector } from '../../db/db-connector.js';

/**
 * Módulo de detección de condiciones de fin de partida.
 *
 * Reglas de victoria (según diseño del juego):
 *  - La partida está en fase `war` con ≤ 1 jugador vivo (capitalHealth > 0 y no eliminado).
 *  - Si queda exactamente 1 → ese jugador es el ganador.
 *  - Si quedan 0 (eliminación simultánea) → empate, no hay ganador (winnerCharacterId = null).
 *  - La partida transiciona a la fase `end`: sigue existiendo en memoria pero no acepta más ataques.
 *  - El DB Server recibe el resultado vía POST /internal/games/{id}/end.
 *
 * NOTA DE SEGURIDAD: Este módulo nunca confía en datos del cliente.
 * La detección se hace enteramente sobre el estado de servidor en GameStore.
 */

/**
 * Evalúa si la partida ha llegado a una condición de fin y, si es así, la resuelve.
 * Debe llamarse después de cualquier operación que pueda eliminar jugadores
 * (resolución de combate, rendición, desconexión prolongada).
 *
 * @param {import('../../models/game').Game} game - Partida a evaluar.
 * @param {import('socket.io').Server} io - Instancia de Socket.IO para emitir el evento final.
 * @returns {boolean} `true` si se detectó condición de fin y se inició la transición; `false` en caso contrario.
 */
export function checkVictory(game, io) {
  // Solo aplica en fase de guerra — en preparación no se puede eliminar a nadie
  if (game.phase !== 'war') {
    return false;
  }

  // Jugadores activos: vivos (capitalHealth > 0) y no marcados como eliminados
  const activePlayers = _getActivePlayers(game);

  // Con más de 1 jugador activo la partida continúa
  if (activePlayers.length > 1) {
    return false;
  }

  // --- Condición de fin detectada ---
  const winner = activePlayers.length === 1 ? activePlayers[0] : null;
  const winnerCharacterId = winner ? winner.characterId : null;

  _resolveGameEnd(game, io, winnerCharacterId);
  return true;
}

// ---------------------------------------------------------------------------
// Funciones privadas
// ---------------------------------------------------------------------------

/**
 * Devuelve los jugadores que siguen vivos en la partida.
 * Un jugador está activo si su capital tiene salud positiva y no ha sido eliminado.
 *
 * @param {import('../../models/game').Game} game
 * @returns {import('../../models/player').Player[]}
 */
function _getActivePlayers(game) {
  return Object.values(game.players).filter(
    (p) => !p.eliminated && p.capitalHealth > 0
  );
}

/**
 * Ejecuta la transición al estado final de la partida:
 *  1. Actualiza la fase en memoria (`end`).
 *  2. Emite `game:ended` a todos los clientes de la sala.
 *  3. Notifica al DB Server de forma asíncrona (sin bloquear el tick).
 *
 * @param {import('../../models/game').Game} game
 * @param {import('socket.io').Server} io
 * @param {string|null} winnerCharacterId - UUID del ganador o null si hay empate.
 */
function _resolveGameEnd(game, io, winnerCharacterId) {
  // Idempotencia: si ya estamos en fase `end` o `finished`, ignorar
  if (game.phase === 'end' || game.phase === 'finished') {
    return;
  }

  game.setPhase('end');

  console.log(
    `[VictoryChecker] Partida ${game.id} → fase END. ` +
      (winnerCharacterId
        ? `Ganador: ${winnerCharacterId}`
        : 'Resultado: EMPATE (0 supervivientes)')
  );

  // Emitir resultado a todos los clientes de la sala
  io.to(`game_${game.id}`).emit('game:ended', {
    gameId: game.id,
    winnerCharacterId,  // null = empate
    phase: 'end',
  });

  // Notificar al DB Server de forma no bloqueante
  // Los errores de red no afectan la resolución del estado en memoria
  dbConnector
    .endGame(game.id, { winnerCharacterId })
    .then(() => {
      console.log(`[VictoryChecker] DB Server notificado: partida ${game.id} finalizada.`);
    })
    .catch((err) => {
      // No propagamos el error — el estado en memoria ya está resuelto.
      // El DB dump periódico podrá sincronizar el estado más tarde.
      console.error(
        `[VictoryChecker] Error al notificar fin de partida ${game.id} al DB Server: ${err.message}`
      );
    });
}
