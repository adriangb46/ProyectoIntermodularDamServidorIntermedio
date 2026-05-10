import { dbConnector } from '../../db/db-connector.js';
import { gameStore } from './game-store.js';
import { Game } from '../../models/game.js';
import { Player } from '../../models/player.js';
import { Troop } from '../../models/troop.js';
import { logger } from '../../utils/logger.js';

/**
 * Orquestador encargado de mantener la sincronización entre el estado
 * en memoria (GameStore) y la persistencia en base de datos (DB Server).
 */
class SyncManager {
  /**
   * Carga el estado inicial recuperando todas las partidas activas
   * desde la base de datos y rehidratando sus instancias en memoria.
   *
   * El DB Server devuelve un GameResponseDto con la siguiente estructura:
   *   {
   *     id, status, maxPlayers, createdAt, startedAt, endedAt,
   *     winnerCharacterId,
   *     participants: [{ id, characterId, joinOrder, eliminated }],
   *     latestStateJson: "<string JSON opaco>" | null
   *   }
   *
   * El estado completo de juego (fase, jugadores, tropas, cola de eventos, etc.)
   * vive exclusivamente en `latestStateJson`, que es el resultado de `game.toJSON()`.
   * Si es null, la partida acaba de ser creada y aún no hay volcados.
   */
  async loadActiveGames() {
    logger.info('[Sync] Sincronizando estado inicial con la DB...');
    try {
      const response = await dbConnector.getActiveGames();

      // El backend puede devolver el array directamente o envuelto en { data: [...] }
      const activeGamesRaw = Array.isArray(response) ? response : (response?.data ?? []);

      let loadedCount = 0;

      for (const gameDto of activeGamesRaw) {
        let game;

        if (gameDto.latestStateJson) {
          // --- Ruta principal: rehidratar desde el último volcado persistido ---
          game = this._rehydrateFromStateJson(gameDto);
        } else {
          // --- Ruta fallback: partida nueva sin ningún volcado todavía ---
          // Construimos un esqueleto a partir de los metadatos y participantes del DTO.
          game = this._rehydrateFromParticipants(gameDto);
        }

        gameStore.addGame(game);
        loadedCount++;
      }

      logger.info({ loadedCount }, '[Sync] Sincronización completada');
    } catch (error) {
      logger.error({ err: error.message }, '[Sync] Error al sincronizar estado inicial');
      // Relanzamos para detener el arranque — no arrancar con estado desincronizado
      throw error;
    }
  }

  /**
   * Rehidrata una partida completa a partir del campo `latestStateJson` del DTO.
   * Este JSON es el producido por `game.toJSON()` en el volcado anterior,
   * por lo que contiene { id, maxPlayers, phase, startedAt, players, eventQueue }.
   *
   * @param {Object} gameDto - El GameResponseDto recibido del DB Server.
   * @returns {Game}
   * @private
   */
  _rehydrateFromStateJson(gameDto) {
    let stateJson;
    try {
      stateJson = JSON.parse(gameDto.latestStateJson);
    } catch (parseError) {
      logger.error({ gameId: gameDto.id, err: parseError.message }, '[Sync] latestStateJson inválido. Usando fallback.');
      // JSON corrupto → caemos al fallback para no perder la partida por completo
      return this._rehydrateFromParticipants(gameDto);
    }

    // Usamos el id del DTO como fuente de verdad (el id del state es equivalente pero
    // preferimos el DTO para mantener coherencia con la DB)
    const game = new Game({ id: gameDto.id, maxPlayers: gameDto.maxPlayers });
    game.phase = (stateJson.phase || 'waiting').toLowerCase();
    game.startedAt = stateJson.startedAt || null;
    game.eventQueue = Array.isArray(stateJson.eventQueue) ? stateJson.eventQueue : [];

    // Rehidratar el mapa de jugadores { [characterId]: playerData }
    if (stateJson.players && typeof stateJson.players === 'object') {
      for (const [charId, playerData] of Object.entries(stateJson.players)) {
        const player = this._rehydratePlayer(playerData);
        // Asignación directa al mapa para evitar el chequeo de capacidad de addPlayer()
        // (la partida ya superó ese punto cuando fue volcada)
        game.players[charId] = player;
      }
    }

    return game;
  }

  /**
   * Crea un esqueleto de partida a partir de los metadatos del DTO y sus `participants`.
   * Se usa cuando `latestStateJson` es null (partida recién creada, aún sin volcados).
   * Los campos desconocidos (userId, clanId, capitalHealth) se rellenarán cuando
   * los jugadores se conecten via Socket.IO.
   *
   * @param {Object} gameDto - El GameResponseDto recibido del DB Server.
   * @returns {Game}
   * @private
   */
  _rehydrateFromParticipants(gameDto) {
    const game = new Game({ id: gameDto.id, maxPlayers: gameDto.maxPlayers });

    // GameStatus del DB Server usa mayúsculas (WAITING, PREPARATION, WAR, END, FINISHED)
    // El Middle Server usa minúsculas internamente
    game.phase = this._mapStatusToPhase(gameDto.status);
    game.startedAt = gameDto.startedAt || null;
    game.eventQueue = [];

    // Crear un jugador esqueleto por cada participante conocido
    if (Array.isArray(gameDto.participants)) {
      // Ordenar por joinOrder para identificar al host (habitualmente el primero)
      const sortedParticipants = [...gameDto.participants].sort((a, b) => (a.joinOrder ?? 0) - (b.joinOrder ?? 0));
      
      for (let i = 0; i < sortedParticipants.length; i++) {
        const participant = sortedParticipants[i];
        const characterId = (participant.characterId ?? participant.id)?.toString();
        if (!characterId) continue;

        const player = new Player({
          characterId,
          userId: null,
          clanId: null,
          capitalHealth: 3000, // Salud base MVP
          isHost: i === 0      // El primero en unirse es el host
        });
        player.eliminated = !!participant.eliminated;
        game.players[characterId] = player;
      }
    }

    return game;
  }

  /**
   * Reconstruye una instancia de Player a partir de sus datos serializados
   * (formato producido por `player.toJSON()`).
   *
   * @param {Object} playerData - Objeto plano del jugador.
   * @returns {Player}
   * @private
   */
  _rehydratePlayer(playerData) {
    const player = new Player({
      characterId: playerData.characterId,
      userId: playerData.userId,
      username: playerData.username,
      clanId: playerData.clanId,
      capitalHealth: playerData.capitalHealth,
      isHost: !!playerData.isHost,
    });

    player.economicCredits = playerData.economicCredits || 0;
    player.researchCredits = playerData.researchCredits || 0;
    player.eliminated = !!playerData.eliminated;
    player.connectedSocketId = playerData.connectedSocketId || null;
    player.unlockedResearches = playerData.unlockedResearches || [];
    player.researchInProgress = playerData.researchInProgress || null;

    // Rehidratar tropas del jugador
    if (Array.isArray(playerData.troops)) {
      for (const troopData of playerData.troops) {
        const troop = new Troop({
          id: troopData.id,
          typeId: troopData.typeId,
          clanId: troopData.clanId,
          maxPoints: troopData.maxPoints,
          currentPoints: troopData.currentPoints
        });

        troop.deployed = !!troopData.deployed;
        troop.travelTargetId = troopData.travelTargetId || null;
        troop.arrivalAt = troopData.arrivalAt || null;

        player.addTroop(troop);
      }
    }

    return player;
  }

  /**
   * Traduce el `GameStatus` del DB Server (enum Java en mayúsculas) a la fase
   * interna del Middle Server (string en minúsculas).
   *
   * @param {string|null} status - El GameStatus devuelto por el DB Server.
   * @returns {string}
   * @private
   */
  _mapStatusToPhase(status) {
    if (!status) return 'waiting';
    return status.toLowerCase();
  }



  /**
   * Mapea una partida (Game) al formato AnalyticsSnapshotRequestDto para MongoDB.
   * @param {Game} game 
   * @returns {Object} DTO de la instantánea analítica.
   */
  mapGameToAnalyticsSnapshot(game) {
    const playersSnapshot = Object.values(game.players).map(player => {
      // Calcular tiempo jugado hasta ahora (si la partida ha empezado)
      if (game.startedAt && !player.stats.timePlayedMs) {
        player.stats.timePlayedMs = Date.now() - game.startedAt;
      } else if (game.startedAt) {
        // Actualizar si ya existía (para volcados periódicos)
        player.stats.timePlayedMs = Date.now() - game.startedAt;
      }

      return {
        characterId: player.characterId,
        clanId: player.clanId || 'unknown',
        economicCredits: player.economicCredits,
        researchCredits: player.researchCredits,
        capitalHealth: player.capitalHealth,
        troops: player.troops.map(troop => ({
          troopId: troop.id,
          typeId: troop.typeId,
          currentPoints: troop.currentPoints,
          deployed: troop.deployed
        })),
        unlockedResearches: player.unlockedResearches,
        eliminated: player.eliminated,
        stats: player.stats
      };
    });

    return {
      gameId: game.id,
      snapshotAt: new Date().toISOString(),
      phase: game.phase.toUpperCase(),
      players: playersSnapshot,
      // El historial de battleEvents se implementará en el futuro
      battleEvents: []
    };
  }
}

export const syncManager = new SyncManager();
