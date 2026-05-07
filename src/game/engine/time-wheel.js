import { randomUUID } from 'node:crypto';
import { GameEvent } from '../../models/game-event.js';
import { Troop } from '../../models/troop.js';
import { checkVictory } from './victory-checker.js';
import { resolveBattle } from './combat-resolver.js';
import { gameData } from '../../config/game-data-loader.js';
import { buildGameView } from './fog-of-war.js';
import { logger } from '../../utils/logger.js';

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
 *   RESOURCE_TICK              → Distribución de créditos económicos (TODO: Dev B)
 *   TROOP_TRAINING_COMPLETE    → Tropa añadida al capital (TODO: Dev B)
 *   TROOP_ARRIVAL              → Resolución de combate + comprobación de victoria (Sprint 3 + Sprint 4)
 *   DB_DUMP_POSTGRES           → Volcado a PostgreSQL (TODO: Dev B DB connector)
 *   DB_DUMP_MONGODB            → Volcado a MongoDB (TODO: Dev B DB connector)
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
      console.warn('[TimeWheel] Ya estaba activo. Se ignora la llamada a start().');
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
      console.warn(`[TimeWheel] scheduleEvent: partida ${gameId} no encontrada en GameStore.`);
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
        // TODO (Dev B): Serializar game.toJSON() y enviar al DB Server via HTTP.
        // Tras el volcado, re-encolar el siguiente DB_DUMP_POSTGRES.
        logger.debug({ gameId: game.id }, '[TimeWheel] DB_DUMP_POSTGRES pendiente de DB connector');
        this._rescheduleRecurring(game, 'DB_DUMP_POSTGRES', this.config.postgresDumpIntervalMs, now);
        break;

      case 'DB_DUMP_MONGODB':
        // TODO (Dev B): Enviar snapshot analítico al DB Server via HTTP.
        // Tras el volcado, re-encolar el siguiente DB_DUMP_MONGODB.
        logger.debug({ gameId: game.id }, '[TimeWheel] DB_DUMP_MONGODB pendiente de DB connector');
        this._rescheduleRecurring(game, 'DB_DUMP_MONGODB', this.config.mongoDbDumpIntervalMs, now);
        break;

      default:
        console.warn(`[TimeWheel] Tipo de evento desconocido: '${event.type}' (partida ${game.id}).`);
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
      percentage = 20;
      nextTickDelay = this._randomBetween(30_000, 60_000);
    } else if (game.phase === 'end') {
      percentage = 15;
      nextTickDelay = 20_000;
    }

    const creditsToAdd = Math.floor((maxCredits * percentage) / 100);

    for (const player of Object.values(game.players)) {
      if (!player.eliminated) {
        player.economicCredits += creditsToAdd;
        // Aplicar límite superior
        if (player.economicCredits > maxCredits) {
          player.economicCredits = maxCredits;
        }
      }
    }

    logger.debug({ gameId: game.id, phase: game.phase, nextTickDelay }, '[TimeWheel] RESOURCE_TICK ejecutado');

    // Emitir vista filtrada por Fog of War a cada jugador conectado individualmente.
    // No se puede hacer un broadcast a la sala completa porque cada jugador
    // debe recibir una versión diferente del estado (sus datos completos + rivales censurados).
    for (const player of Object.values(game.players)) {
      if (player.connectedSocketId) {
        this.io.to(player.connectedSocketId).emit(
          'game:state-sync',
          buildGameView(game, player.characterId)
        );
      }
    }

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
      newPhase: 'war',
    });

    // Programar el primer tick de recursos (intervalo aleatorio 30-60s según arquitectura)
    const firstResourceTickDelay = this._randomBetween(30_000, 60_000);
    this.scheduleEvent(game.id, new GameEvent({
      gameId: game.id,
      type: 'RESOURCE_TICK',
      executeAt: Date.now() + firstResourceTickDelay,
    }));
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
    for (const p of Object.values(game.players)) {
      if (p.connectedSocketId) {
        this.io.to(p.connectedSocketId).emit('game:state-sync', buildGameView(game, p.characterId));
      }
    }
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
    for (const p of Object.values(game.players)) {
      if (p.connectedSocketId) {
        this.io.to(p.connectedSocketId).emit('game:state-sync', buildGameView(game, p.characterId));
      }
    }
  }

  /**
   * Gestiona la llegada de una tropa al destino de ataque.
   * Aplica idempotencia, maneja al defensor eliminado y deja el hueco para combat-resolver (Sprint 3 Punto 2).
   *
   * @param {import('../../models/game').Game} game
   * @param {Object} payload - { troopId, attackerCharacterId, targetCharacterId }
   */
  _handleTroopArrival(game, payload) {
    const { troopId, attackerCharacterId, targetCharacterId } = payload;

    // Buscar al jugador atacante
    const attacker = game.getPlayer(attackerCharacterId);
    if (!attacker) {
      console.warn(`[TimeWheel] _handleTroopArrival: atacante ${attackerCharacterId} no existe (partida ${game.id}).`);
      return;
    }

    // Buscar la tropa por su ID único
    const troop = attacker.troops.find(t => t.id === troopId);
    if (!troop) {
      console.warn(`[TimeWheel] _handleTroopArrival: tropa ${troopId} no encontrada para atacante ${attackerCharacterId}.`);
      return;
    }

    // Idempotencia: si la tropa ya no está desplegada, el evento ya fue procesado o fue cancelado
    if (!troop.deployed) {
      return;
    }

    // Caso especial: el defensor fue eliminado mientras la tropa viajaba
    const defender = game.getPlayer(targetCharacterId);
    if (!defender || defender.eliminated) {
      logger.info({ troopId, targetCharacterId }, '[TimeWheel] Objetivo ya eliminado. Tropa regresa a casa.');
      troop.returnHome();
      this.io.to(`game_${game.id}`).emit('game:troop-returned', {
        attackerCharacterId,
        troopId,
        reason: 'target_eliminated',
      });
      return;
    }

    // --- Resolución de combate real (Sprint 3 Punto 2) ---
    // La tropa que dispara este evento es la única participante del ataque
    const attackingTroops = [troop];
    const result = resolveBattle(attacker, defender, attackingTroops, gameData);

    // Aplicar créditos de investigación al atacante (con cap al máximo configurado)
    attacker.researchCredits = Math.min(
      attacker.researchCredits + result.researchCreditsEarned,
      this.config.maxResearchCredits
    );

    // Retornar tropas supervivientes a la capital del atacante
    for (const survivor of result.attackerSurvivors) {
      survivor.returnHome();
    }

    logger.info({
      gameId: game.id,
      attacker: attackerCharacterId,
      target: targetCharacterId,
      damage: result.capitalDamage,
      eliminated: result.defenderEliminated
    }, '[TimeWheel] Batalla resuelta');

    // Notificar a todos los jugadores de la sala
    // Fog of War: sin IDs de tropas individuales ni vida exacta del defensor
    this.io.to(`game_${game.id}`).emit('game:battle-result', {
      attackerCharacterId,
      targetCharacterId,
      capitalDamage: result.capitalDamage,
      attackerTroopsLost: result.attackerTroopsLost.length,
      defenderTroopsDestroyed: result.defenderTroopsDestroyed.length,
      defenderEliminated: result.defenderEliminated,
      researchCreditsEarned: result.researchCreditsEarned,
    });

    // Comprobar condición de victoria tras la batalla
    checkVictory(game, this.io);
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
