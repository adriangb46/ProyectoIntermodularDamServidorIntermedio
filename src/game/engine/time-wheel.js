import { randomUUID } from 'node:crypto';
import { GameEvent } from '../../models/game-event.js';
import { checkVictory } from './victory-checker.js';

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
    console.log(`[TimeWheel] Arrancado. Tick cada ${this.config.timeWheelTickMs}ms.`);
  }

  /**
   * Detiene el bucle principal.
   * Útil en tests unitarios para evitar timers activos tras cada suite.
   */
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
      console.log('[TimeWheel] Detenido.');
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
        // TODO (Dev B): Añadir la tropa completada al capital del jugador.
        // event.payload = { characterId, troopTypeId }
        console.log(`[TimeWheel] TROOP_TRAINING_COMPLETE pendiente (partida ${game.id}).`);
        break;

      case 'TROOP_ARRIVAL':
        // TODO (Sprint 3): Invocar combat-resolver con los datos del ataque.
        // event.payload = { troopId, attackerCharacterId, targetCharacterId }
        console.log(`[TimeWheel] TROOP_ARRIVAL pendiente de combat-resolver (partida ${game.id}).`);
        // Sprint 4: Comprobar condición de victoria tras resolver el combate.
        // Cuando combat-resolver esté implementado, mover esta llamada a _handleTroopArrival().
        checkVictory(game, this.io);
        break;

      case 'DB_DUMP_POSTGRES':
        // TODO (Dev B): Serializar game.toJSON() y enviar al DB Server via HTTP.
        // Tras el volcado, re-encolar el siguiente DB_DUMP_POSTGRES.
        console.log(`[TimeWheel] DB_DUMP_POSTGRES pendiente de DB connector (partida ${game.id}).`);
        this._rescheduleRecurring(game, 'DB_DUMP_POSTGRES', this.config.postgresDumpIntervalMs, now);
        break;

      case 'DB_DUMP_MONGODB':
        // TODO (Dev B): Enviar snapshot analítico al DB Server via HTTP.
        // Tras el volcado, re-encolar el siguiente DB_DUMP_MONGODB.
        console.log(`[TimeWheel] DB_DUMP_MONGODB pendiente de DB connector (partida ${game.id}).`);
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

    console.log(`[TimeWheel] RESOURCE_TICK ejecutado (partida ${game.id}, fase ${game.phase}). Siguiente en ${nextTickDelay}ms.`);

    // Emitir volcado de estado a los clientes de la partida
    this.io.to(`game_${game.id}`).emit('game:state-update', game.toJSON());

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
    console.log(`[TimeWheel] Partida ${game.id} → fase GUERRA iniciada.`);

    // Notificar a todos los clientes conectados en la sala de la partida
    this.io.to(`game_${game.id}`).emit('game:phase-change', {
      gameId: game.id,
      phase: 'war',
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

    console.log(`[TimeWheel] Investigación completada: ${researchId} para ${characterId}`);

    // Notificar al jugador
    this.io.to(`game_${game.id}`).emit('player:research-complete', {
      characterId,
      researchId,
      unlockedResearches: player.unlockedResearches
    });
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
