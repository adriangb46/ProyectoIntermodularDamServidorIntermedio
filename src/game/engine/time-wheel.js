import { randomUUID } from 'node:crypto';
import { GameEvent } from '../../models/game-event.js';
import { Troop } from '../../models/troop.js';
import { checkVictory } from './victory-checker.js';
import { resolveBattle } from './combat-resolver.js';
import { gameData } from '../../config/game-data-loader.js';
import { buildGameView } from './fog-of-war.js';
import { logger } from '../../utils/logger.js';
import { dbConnector } from '../../db/db-connector.js';
import { syncManager } from '../state/sync-manager.js';

/**
 * Motor de tiempo centralizado del Middle Server.
 * Es el ÚNICO lugar donde se crean temporizadores (setInterval/setTimeout) para lógica de juego.
 *
 * Arquitectura:
 *   - Ticks a intervalo fijo (timeWheelTickMs, defecto 500ms).
 *   - En cada tick recorre todas las partidas del GameStore.
 *   - Por cada partida, procesa los eventos cuyo executeAt <= now.
 *   - La cola de eventos se mantiene ordenada por executeAt (ascendente) para
 *     poder hacer peek al primer elemento y salir del bucle rápidamente.
 *
 * Tipos de evento gestionados (sección 10 del proyect_arquitecture.md):
 *   PHASE_TRANSITION_WAR       → Preparación → Guerra (implementado)
 *   RESOURCE_TICK              → Distribución de créditos económicos
 *   TROOP_TRAINING_COMPLETE    → Tropa añadida al capital
 *   TROOP_ARRIVAL              → Resolución de combate + comprobación de victoria
 *   DB_DUMP_POSTGRES           → Volcado a PostgreSQL
 *   DB_DUMP_MONGODB            → Volcado a MongoDB
 */
export class TimeWheel {
  /**
   * @param {import('../state/game-store').GameStore} gameStore - Almacén de partidas activas.
   * @param {import('socket.io').Server} io - Instancia de Socket.IO para emitir eventos.
   * @param {import('../../config/index').config} config - Configuración centralizada.
   */
  constructor(gameStore, io, config) {
    this.gameStore = gameStore;
    this.io = io;
    this.config = config;

    /** @type {NodeJS.Timeout | null} Referencia al interval activo (para poder detenerlo). */
    this._interval = null;
  }

  // ---------------------------------------------------------------------------
  // Control del bucle
  // ---------------------------------------------------------------------------

  /**
   * Arranca el bucle principal del Time Wheel.
   * Solo se debe llamar una vez al iniciar el servidor.
   */
  start() {
    if (this._interval) {
      logger.warn('[TimeWheel] Ya estaba activo. Se ignora la llamada a start().');
      return;
    }
    this._interval = setInterval(() => this._processTick(), this.config.timeWheelTickMs);
    logger.info(`[TimeWheel] Arrancado. Tick cada ${this.config.timeWheelTickMs}ms.`);
  }

  /**
   * Detiene el bucle principal.
   * Útil en tests unitarios para evitar timers activos tras cada suite.
   */
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
      logger.info('[TimeWheel] Detenido.');
    }
  }

  // ---------------------------------------------------------------------------
  // Scheduling público
  // ---------------------------------------------------------------------------

  /**
   * Inserta un nuevo evento en la cola de la partida indicada.
   * La inserción mantiene la cola ordenada por executeAt (ascendente) para
   * optimizar el peek en cada tick.
   *
   * @param {string} gameId - ID de la partida destino.
   * @param {import('../../models/game-event').GameEvent} event - Evento a encolar.
   */
  scheduleEvent(gameId, event) {
    const game = this.gameStore.getGame(gameId);
    if (!game) {
      logger.warn({ gameId }, '[TimeWheel] scheduleEvent: partida no encontrada en GameStore.');
      return;
    }

    // Inserción ordenada por executeAt para mantener la cola como min-heap básico
    const queue = game.eventQueue;
    let i = queue.length;
    while (i > 0 && queue[i - 1].executeAt > event.executeAt) {
      i--;
    }
    queue.splice(i, 0, event);
  }

  // ---------------------------------------------------------------------------
  // Bucle interno
  // ---------------------------------------------------------------------------

  /**
   * Ejecutado en cada tick del setInterval.
   * Recorre todas las partidas activas y procesa los eventos vencidos.
   */
  _processTick() {
    const now = Date.now();

    for (const game of this.gameStore.getAll()) {
      // Programar los volcados iniciales si la partida acaba de ser cargada/creada
      if (!game.hasInitialDumpsScheduled) {
        // Añadimos un pequeño jitter aleatorio para que no todas las partidas vuelquen a la vez si hay muchas
        const jitter = Math.floor(Math.random() * 5000);
        this._rescheduleRecurring(game, 'DB_DUMP_POSTGRES', this.config.postgresDumpIntervalMs + jitter, now);
        this._rescheduleRecurring(game, 'DB_DUMP_MONGODB', this.config.mongoDbDumpIntervalMs + jitter, now);
        game.hasInitialDumpsScheduled = true;
      }

      // Procesamos eventos mientras el primero de la cola ya esté vencido
      while (game.eventQueue.length > 0 && game.eventQueue[0].executeAt <= now) {
        const event = game.eventQueue.shift();
        this._processEvent(game, event, now);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Procesador de eventos
  // ---------------------------------------------------------------------------

  /**
   * Despacha un evento a su manejador correspondiente.
   * Garantiza idempotencia: si el evento ya fue procesado, lo descarta sin efectos.
   *
   * @param {import('../../models/game').Game} game - Partida propietaria del evento.
   * @param {import('../../models/game-event').GameEvent} event - Evento a procesar.
   * @param {number} now - Timestamp del tick actual (ms).
   */
  _processEvent(game, event, now) {
    // Garantía de idempotencia: descartar eventos ya procesados
    if (event.processed) {
      return;
    }
    event.processed = true;

    switch (event.type) {

      case 'PHASE_TRANSITION_WAR':
        this._handlePhaseTransitionWar(game);
        break;

      case 'PHASE_TRANSITION_END':
        this._handlePhaseTransitionEnd(game);
        break;

      case 'RESOURCE_TICK':
        this._handleResourceTick(game, now);
        break;

      case 'RESEARCH_COMPLETE':
        this._handleResearchComplete(game, event.payload);
        break;

      case 'TROOP_TRAINING_COMPLETE':
        this._handleTroopTrainingComplete(game, event.payload);
        break;

      case 'TROOP_ARRIVAL':
        this._handleTroopArrival(game, event.payload);
        break;

      case 'DB_DUMP_POSTGRES':
        dbConnector.dumpState(game.id, game.toJSON()).then(() => {
          logger.debug({ gameId: game.id }, '[TimeWheel] DB_DUMP_POSTGRES completado');
        }).catch(err => {
          logger.error({ gameId: game.id, err: err.message }, '[TimeWheel] Error al volcar estado de partida');
        });
        this._rescheduleRecurring(game, 'DB_DUMP_POSTGRES', this.config.postgresDumpIntervalMs, now);
        break;

      case 'DB_DUMP_MONGODB':
        {
          const snapshotDto = syncManager.mapGameToAnalyticsSnapshot(game);
          dbConnector.publishAnalyticsSnapshot(snapshotDto).then(() => {
            logger.debug({ gameId: game.id }, '[TimeWheel] DB_DUMP_MONGODB completado');
          }).catch(err => {
            logger.error({ gameId: game.id, err: err.message }, '[TimeWheel] Error al volcar analítica');
          });
          this._rescheduleRecurring(game, 'DB_DUMP_MONGODB', this.config.mongoDbDumpIntervalMs, now);
        }
        break;

      default:
        logger.warn({ type: event.type, gameId: game.id }, '[TimeWheel] Tipo de evento desconocido');
    }
  }

  // ---------------------------------------------------------------------------
  // Manejadores de evento concretos
  // ---------------------------------------------------------------------------

  /**
   * Distribuye créditos económicos a los jugadores según la fase actual.
   * - Fase Guerra: 20% del máximo cada 30-60s.
   * - Fase Veredicto (end): 15% del máximo cada 20s.
   * 
   * @param {import('../../models/game').Game} game
   * @param {number} now
   */
  _handleResourceTick(game, now) {
    if (game.phase !== 'war' && game.phase !== 'end') {
      return; // No se otorgan recursos en otras fases
    }

    const maxCredits = this.config.maxEconomicCredits;
    let percentage = 0;
    let nextTickDelay = 0;

    if (game.phase === 'war') {
      percentage = this.config.warResourcePercentage;
      nextTickDelay = this._randomBetween(this.config.warResourceIntervalMinMs, this.config.warResourceIntervalMaxMs);
    } else if (game.phase === 'end') {
      percentage = this.config.endResourcePercentage;
      nextTickDelay = this.config.endResourceIntervalMs;
    }

    const creditsToAdd = Math.floor((maxCredits * percentage) / 100);

    for (const player of Object.values(game.players)) {
      if (!player.eliminated) {
        player.economicCredits += creditsToAdd;
        // Aplicar límite superior
        if (player.economicCredits > maxCredits) {
          player.economicCredits = maxCredits;
        }
        // Tracking estadístico
        player.stats.totalEconomicCreditsEarned += creditsToAdd;
      }
    }

    logger.debug({ gameId: game.id, phase: game.phase, nextTickDelay }, '[TimeWheel] RESOURCE_TICK ejecutado');

    // Emitir vista filtrada por Fog of War a cada jugador conectado individualmente.
    // No se puede hacer un broadcast a la sala completa porque cada jugador
    // debe recibir una versión diferente del estado (sus datos completos + rivales censurados).
    // Emitir vista filtrada por Fog of War a cada jugador conectado individualmente.
    this._syncGameStateToAll(game);

    // Programar el siguiente tick
    this.scheduleEvent(game.id, new GameEvent({
      id: randomUUID(),
      gameId: game.id,
      type: 'RESOURCE_TICK',
      executeAt: now + nextTickDelay,
    }));
  }

  /**
   * Gestiona la transición de la fase Preparación → Guerra.
   * Actualiza el estado en memoria y notifica a todos los jugadores de la sala.
   *
   * @param {import('../../models/game').Game} game
   */
  _handlePhaseTransitionWar(game) {
    if (game.phase !== 'preparation') {
      // Idempotencia: si ya no estamos en preparación, ignorar
      return;
    }

    game.setPhase('war');
    logger.info({ gameId: game.id }, '[TimeWheel] Fase GUERRA iniciada');

    // Notificar a todos los clientes conectados en la sala de la partida
    this.io.to(`game_${game.id}`).emit('game:phase-changed', {
      gameId: game.id,
      newPhase: 'WAR',
    });

    // Programar el primer tick de recursos (intervalo aleatorio según configuración)
    const firstResourceTickDelay = this._randomBetween(this.config.warResourceIntervalMinMs, this.config.warResourceIntervalMaxMs);
    this.scheduleEvent(game.id, new GameEvent({
      gameId: game.id,
      type: 'RESOURCE_TICK',
      executeAt: Date.now() + firstResourceTickDelay,
    }));

    // REGLA PARA PARTIDAS DE 2 JUGADORES
    const totalPlayers = Object.keys(game.players).length;
    if (totalPlayers === 2) {
      // Programar la transición a END para dentro de 10 minutos (600_000 ms)
      logger.info({ gameId: game.id }, '[TimeWheel] Partida de 2 jugadores: fase END programada en 10 min');
      this.scheduleEvent(game.id, new GameEvent({
        id: randomUUID(),
        gameId: game.id,
        type: 'PHASE_TRANSITION_END',
        executeAt: Date.now() + 600_000,
      }));
    }
  }

  /**
   * Gestiona la transición de la fase Guerra → End (batalla final).
   * Ocurre en partidas que empezaron con 2 jugadores, tras pasar 10 minutos en guerra.
   *
   * @param {import('../../models/game').Game} game
   */
  _handlePhaseTransitionEnd(game) {
    if (game.phase !== 'war') {
      return;
    }

    game.setPhase('end');
    logger.info({ gameId: game.id }, '[TimeWheel] Fase END (batalla final) iniciada por temporizador');

    this.io.to(`game_${game.id}`).emit('game:phase-changed', {
      gameId: game.id,
      newPhase: 'END',
    });
  }

  /**
   * Finaliza una investigación tecnológica.
   * Actualiza el estado del jugador y notifica al cliente.
   * 
   * @param {import('../../models/game').Game} game 
   * @param {Object} payload - { characterId, researchId }
   */
  _handleResearchComplete(game, payload) {
    const { characterId, researchId } = payload;
    const player = game.getPlayer(characterId);

    if (!player || player.eliminated) return;

    // Verificar que la investigación coincide (idempotencia)
    if (player.researchInProgress?.researchId !== researchId) {
      return;
    }

    // Desbloquear
    player.unlockedResearches.push(researchId);
    player.researchInProgress = null;

    logger.info({ characterId, researchId }, '[TimeWheel] Investigación completada');

    // Notificar al jugador
    // Notificar al jugador afectado
    if (player.connectedSocketId) {
      this.io.to(player.connectedSocketId).emit('player:research-complete', {
        characterId,
        researchId,
        unlockedResearches: player.unlockedResearches
      });
    }

    // Sincronizar estado completo para reflejar el cambio en la cola/investigación
    this._syncGameStateToAll(game);
  }

  /**
   * Finaliza el entrenamiento de una tropa.
   * Añade la tropa a la capital del jugador y notifica al cliente.
   *
   * @param {import('../../models/game').Game} game
   * @param {Object} payload - { characterId, troopTypeId, maxPoints, trainingId }
   */
  _handleTroopTrainingComplete(game, payload) {
    const { characterId, troopTypeId, maxPoints, trainingId } = payload;
    const player = game.getPlayer(characterId);

    if (!player || player.eliminated) return;

    // Idempotencia: Verificar si esta tarea sigue en la cola de entrenamiento
    if (!player.trainingQueue) return;
    const queueIndex = player.trainingQueue.findIndex(q => q.trainingId === trainingId);
    if (queueIndex === -1) {
      // Ya procesado o cancelado
      return;
    }

    // Eliminar de la cola
    player.trainingQueue.splice(queueIndex, 1);

    // Instanciar tropa y añadir
    const troop = new Troop({
      typeId: troopTypeId,
      clanId: player.clanId,
      maxPoints
    });

    player.addTroop(troop);

    logger.info({ characterId, troopTypeId }, '[TimeWheel] Entrenamiento completado');

    // Notificar al jugador
    // Notificar al jugador afectado
    if (player.connectedSocketId) {
      this.io.to(player.connectedSocketId).emit('player:troop-trained', {
        characterId,
        troop: troop.toJSON(),
        trainingQueue: player.trainingQueue
      });
    }

    // Sincronizar estado completo para reflejar la nueva tropa en el capital
    this._syncGameStateToAll(game);

    // Tracking estadístico
    player.stats.totalTroopsTrained += 1;
  }

  /**
   * Gestiona la llegada de tropas al destino de ataque.
   * Resuelve el combate con TODAS las tropas del ataque agrupadas,
   * sincroniza el estado a todos los clientes y comprueba victoria.
   *
   * @param {import('../../models/game').Game} game
   * @param {Object} payload - { troopIds: string[], attackerCharacterId, targetCharacterId }
   */
  _handleTroopArrival(game, payload) {
    const { attackerCharacterId, targetCharacterId } = payload;

    // Compatibilidad: soportar tanto troopIds (array) como troopId (string individual, formato antiguo)
    const troopIds = payload.troopIds || (payload.troopId ? [payload.troopId] : []);

    if (troopIds.length === 0) {
      logger.warn({ gameId: game.id }, '[TimeWheel] _handleTroopArrival: sin troopIds en el payload');
      return;
    }

    // Buscar al jugador atacante
    const attacker = game.getPlayer(attackerCharacterId);
    if (!attacker) {
      logger.warn({ attackerCharacterId, gameId: game.id }, '[TimeWheel] _handleTroopArrival: atacante no existe');
      return;
    }

    // Resolver las instancias de tropa y filtrar las válidas (desplegadas y vivas)
    const attackingTroops = [];
    for (const troopId of troopIds) {
      const troop = attacker.troops.find(t => t.id === troopId);
      if (!troop) {
        logger.warn({ troopId, attackerCharacterId }, '[TimeWheel] _handleTroopArrival: tropa no encontrada');
        continue;
      }
      // Idempotencia: si la tropa ya no está desplegada, fue procesada o cancelada
      if (!troop.deployed) {
        continue;
      }
      attackingTroops.push(troop);
    }

    // Si ninguna tropa válida quedó, no hay combate
    if (attackingTroops.length === 0) {
      logger.info({ attackerCharacterId, gameId: game.id }, '[TimeWheel] Todas las tropas del ataque fueron invalidadas');
      return;
    }

    // Caso especial: el defensor fue eliminado mientras las tropas viajaban
    const defender = game.getPlayer(targetCharacterId);
    if (!defender || defender.eliminated) {
      logger.info({ targetCharacterId }, '[TimeWheel] Objetivo ya eliminado. Tropas regresan a casa.');
      for (const troop of attackingTroops) {
        troop.returnHome();
      }
      this.io.to(`game_${game.id}`).emit('game:troop-returned', {
        attackerCharacterId,
        troopIds: attackingTroops.map(t => t.id),
        reason: 'target_eliminated',
      });
      // Sincronizar estado para reflejar el regreso de las tropas
      this._syncGameStateToAll(game);
      return;
    }

    // --- Resolución de combate real ---
    const result = resolveBattle(attacker, defender, attackingTroops, gameData);

    // Aplicar créditos de investigación al atacante (con cap al máximo configurado)
    attacker.researchCredits = Math.min(
      attacker.researchCredits + result.researchCreditsEarned,
      this.config.maxResearchCredits
    );

    // Aplicar resultados al atacante (limpiar muertos y manejar supervivientes)
    // Regla: Si el defensor NO es eliminado, las tropas atacantes supervivientes NO regresan (misión suicida)
    if (result.defenderEliminated) {
      for (const survivor of result.attackerSurvivors) {
        survivor.returnHome();
      }
    } else {
      // Si no ganaron, los supervivientes se consideran bajas en el asalto fallido
      for (const survivor of result.attackerSurvivors) {
        survivor.currentPoints = 0; // Se marcan como muertas para que cleanup las borre
      }
    }
    
    // Limpiar bajas de ambos bandos
    defender.cleanupDeadTroops();
    attacker.cleanupDeadTroops();

    logger.info({
      gameId: game.id,
      attacker: attackerCharacterId,
      target: targetCharacterId,
      troopCount: attackingTroops.length,
      damage: result.capitalDamage,
      eliminated: result.defenderEliminated
    }, '[TimeWheel] Batalla resuelta');

    // Tracking estadístico
    attacker.stats.totalAttacksLaunched += 1;
    attacker.stats.totalDamageDealt += result.capitalDamage;
    defender.stats.totalDamageReceived += result.capitalDamage;
    attacker.stats.totalTroopsLost += result.attackerTroopsLost.length;
    defender.stats.totalTroopsLost += result.defenderTroopsDestroyed.length;
    attacker.stats.totalResearchCreditsEarned += result.researchCreditsEarned;

    // Notificar el resultado de la batalla a todos los jugadores de la sala
    this.io.to(`game_${game.id}`).emit('game:battle-result', {
      attackerCharacterId,
      attackerUsername: attacker.username,
      targetCharacterId,
      capitalDamage: result.capitalDamage,
      attackerTroopsLost: result.attackerTroopsLost.length,
      defenderTroopsDestroyed: result.defenderTroopsDestroyed.length,
      defenderEliminated: result.defenderEliminated,
      researchCreditsEarned: result.researchCreditsEarned,
      // Añadimos la salud actual para que el frontend pueda actualizar sus barras de vida sin esperar al sync
      characterHealth: {
        current: defender.capitalHealth,
        max: gameData[defender.clanId]?.baseCapitalHealth || this.config.defaultCapitalHealth
      }
    });

    // Sincronizar estado completo a todos los clientes (Fog of War)
    // Esto es CRÍTICO para que el frontend vea las tropas actualizadas
    this._syncGameStateToAll(game);

    // Comprobar condición de victoria tras la batalla
    checkVictory(game, this.io);
  }

  /**
   * Sincroniza el estado de la partida a todos los jugadores conectados,
   * aplicando Fog of War individual por jugador.
   *
   * @param {import('../../models/game').Game} game
   */
  _syncGameStateToAll(game) {
    for (const player of Object.values(game.players)) {
      if (player.connectedSocketId) {
        const view = buildGameView(game, player.characterId);
        this.io.to(player.connectedSocketId).emit('game:state-sync', {
          ...view,
          myCharacterId: player.characterId
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Utilidades internas
  // ---------------------------------------------------------------------------

  /**
   * Re-encola un evento recurrente (DB dumps) en la misma partida.
   * Los eventos DB_DUMP_* no se persisten en state_json; se re-crean en cada arranque.
   *
   * @param {import('../../models/game').Game} game
   * @param {string} type - Tipo del evento a re-encolar.
   * @param {number} intervalMs - Intervalo en ms hasta la próxima ejecución.
   * @param {number} now - Timestamp actual del tick.
   */
  _rescheduleRecurring(game, type, intervalMs, now) {
    this.scheduleEvent(game.id, new GameEvent({
      id: randomUUID(),
      gameId: game.id,
      type,
      executeAt: now + intervalMs,
    }));
  }

  /**
   * Genera un número entero aleatorio entre min y max (inclusive).
   *
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  _randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
