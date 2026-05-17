import { dbConnector } from '../../db/db-connector.js';
import { syncManager } from '../state/sync-manager.js';
import { gameStore } from '../state/game-store.js';
import { logger } from '../../utils/logger.js';

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
  // Se evalúa en las fases iniciadas (preparación, guerra y batalla final)
  if (!['preparation', 'war', 'end'].includes(game.phase)) {
    return false;
  }

  // Jugadores activos: vivos (capitalHealth > 0) y no marcados como eliminados
  const activePlayers = _getActivePlayers(game);

  // Con más de 2 jugadores activos la partida continúa en fase de guerra
  if (activePlayers.length > 2) {
    return false;
  }

  // Si quedan exactamente 2 jugadores y estamos en guerra, transicionamos a la fase final (end)
  if (activePlayers.length === 2) {
    if (game.phase === 'war') {
      _resolveGameEnd(game, io);
      return true;
    }
    // Si ya estamos en 'end', simplemente continuamos
    return false;
  }

  // --- Condición de fin detectada (1 o 0 jugadores) ---
  const winner = activePlayers.length === 1 ? activePlayers[0] : null;
  const winnerCharacterId = winner ? winner.characterId : null;

  _resolveGameFinished(game, io, winnerCharacterId);
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
 * Ejecuta la transición a la fase final de la partida (2 jugadores restantes):
 *  1. Actualiza la fase en memoria (`end`).
 *  2. Emite `game:phase-changed` a todos los clientes de la sala.
 *
 * @param {import('../../models/game').Game} game
 * @param {import('socket.io').Server} io
 */
function _resolveGameEnd(game, io) {
  // Idempotencia: si ya estamos en fase `end` o `finished`, ignorar
  if (game.phase === 'end' || game.phase === 'finished') {
    return;
  }

  game.setPhase('end');

  logger.info({ gameId: game.id }, '[VictoryChecker] Partida → fase END (2 jugadores restantes).');

  // Emitir resultado a todos los clientes de la sala
  io.to(`game_${game.id}`).emit('game:phase-changed', {
    gameId: game.id,
    newPhase: 'end',
  });

  // REALIZAR VOLCADOS INTERMEDIOS PARA ASEGURAR ESTADÍSTICAS
  _performFinalDumps(game);
}

/**
 * Ejecuta la transición al estado terminado de la partida (1 o 0 jugadores):
 *  1. Actualiza la fase en memoria (`finished`).
 *  2. Emite `game:ended` a todos los clientes de la sala.
 *  3. Notifica al DB Server de forma asíncrona.
 *
 * @param {import('../../models/game').Game} game
 * @param {import('socket.io').Server} io
 * @param {string|null} winnerCharacterId - UUID del ganador o null si hay empate.
 */
function _resolveGameFinished(game, io, winnerCharacterId) {
  // Idempotencia: si ya estamos en fase `finished`, ignorar
  if (game.phase === 'finished') {
    return;
  }

  game.winnerCharacterId = winnerCharacterId || null;
  game.setPhase('finished');
  gameStore.recordFinishedGame(game.id);

  logger.info({ 
    gameId: game.id, 
    winnerCharacterId 
  }, '[VictoryChecker] Partida → fase FINISHED. ' + (winnerCharacterId ? `Ganador: ${winnerCharacterId}` : 'Resultado: EMPATE'));

  // Emitir resultado a todos los clientes de la sala
  io.to(`game_${game.id}`).emit('game:ended', {
    gameId: game.id,
    winnerCharacterId,  // null = empate
    phase: 'finished',
  });

  // Notificar al DB Server de forma no bloqueante
  dbConnector
    .endGame(game.id, { winnerCharacterId })
    .then(() => {
      logger.info({ gameId: game.id }, '[VictoryChecker] DB Server notificado: partida finalizada.');
      
      // REALIZAR VOLCADOS FINALES PARA ASEGURAR ESTADÍSTICAS
      _performFinalDumps(game);
    })
    .catch((err) => {
      logger.error({ 
        gameId: game.id, 
        err: err.message 
      }, '[VictoryChecker] Error al notificar fin de partida al DB Server');
      
      // Intentar los volcados incluso si endGame falla (mejor tener datos parciales que nada)
      _performFinalDumps(game);
    });
}

/**
 * Realiza los volcados de estado (PostgreSQL) y analítica (MongoDB) de forma inmediata.
 * @param {import('../../models/game').Game} game
 * @private
 */
function _performFinalDumps(game) {
  logger.info({ gameId: game.id }, '[VictoryChecker] Ejecutando volcados forzados (Postgres + MongoDB)');

  // 1. Volcado a PostgreSQL (estado persistente)
  dbConnector.dumpState(game.id, game.toJSON()).then(() => {
    logger.debug({ gameId: game.id }, '[VictoryChecker] Dump Postgres forzado completado');
  }).catch(err => {
    logger.error({ gameId: game.id, err: err.message }, '[VictoryChecker] Error en dump Postgres forzado');
  });

  // 2. Volcado a MongoDB (Analíticas / Estadísticas)
  try {
    const snapshotDto = syncManager.mapGameToAnalyticsSnapshot(game);
    dbConnector.publishAnalyticsSnapshot(snapshotDto).then(() => {
      logger.debug({ gameId: game.id }, '[VictoryChecker] Snapshot MongoDB forzado completado');
    }).catch(err => {
      logger.error({ gameId: game.id, err: err.message }, '[VictoryChecker] Error en snapshot MongoDB forzado');
    });
  } catch (err) {
    logger.error({ gameId: game.id, err: err.message }, '[VictoryChecker] Error al mapear analítica para dump forzado');
  }
}
