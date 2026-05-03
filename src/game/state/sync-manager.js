import { dbConnector } from '../../connectors/db-connector.js';
import { gameStore } from './game-store.js';
import { Game } from '../../models/game.js';
import { Player } from '../../models/player.js';
import { Troop } from '../../models/troop.js';

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
    console.log('🔄 Sincronizando estado inicial con la DB...');
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

      console.log(`✅ Sincronización completada. ${loadedCount} partidas rehidratadas en memoria.`);
    } catch (error) {
      console.error('❌ Error al sincronizar el estado inicial desde la DB:', error.message);
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
      console.error(
        `❌ latestStateJson inválido para la partida ${gameDto.id}. Usando fallback de participantes.`,
        parseError.message
      );
      // JSON corrupto → caemos al fallback para no perder la partida por completo
      return this._rehydrateFromParticipants(gameDto);
    }

    // Usamos el id del DTO como fuente de verdad (el id del state es equivalente pero
    // preferimos el DTO para mantener coherencia con la DB)
    const game = new Game({ id: gameDto.id, maxPlayers: gameDto.maxPlayers });
    game.phase = stateJson.phase || 'waiting';
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
      for (const participant of gameDto.participants) {
        // characterId es el identificador principal en el Middle Server
        const characterId = (participant.characterId ?? participant.id)?.toString();
        if (!characterId) continue;

        const player = new Player({
          characterId,
          userId: null,       // Desconocido hasta que el usuario se conecte
          clanId: null,       // Desconocido hasta que el usuario se conecte
          capitalHealth: 100  // Valor por defecto — el estado real vendrá en el próximo volcado
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
      clanId: playerData.clanId,
      capitalHealth: playerData.capitalHealth
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
   * Inicia el volcado periódico del estado de la memoria a la base de datos.
   * @param {number} intervalMs - Intervalo en milisegundos entre volcados.
   */
  startPeriodicSync(intervalMs) {
    console.log(`⏱️  Iniciando volcado periódico a PostgreSQL (cada ${intervalMs}ms)`);

    setInterval(async () => {
      const games = gameStore.getAll();
      if (games.length === 0) return; // Nada que volcar

      let dumpedCount = 0;
      let errorsCount = 0;

      for (const game of games) {
        try {
          await dbConnector.dumpState(game.id, game.toJSON());
          dumpedCount++;
        } catch (error) {
          console.error(`❌ Error al volcar el estado de la partida ${game.id}:`, error.message);
          errorsCount++;
        }
      }

      if (errorsCount > 0) {
        console.warn(`⚠️ Volcado periódico finalizado con ${errorsCount} errores (Volcadas: ${dumpedCount}).`);
      } else {
        console.log(`💾 Volcado periódico exitoso: ${dumpedCount} partidas guardadas en PostgreSQL.`);
      }
    }, intervalMs);
  }
}

export const syncManager = new SyncManager();
