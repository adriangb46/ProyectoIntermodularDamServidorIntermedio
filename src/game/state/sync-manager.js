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
   * desde la base de datos y rehidratando sus instancias.
   */
  async loadActiveGames() {
    console.log('🔄 Sincronizando estado inicial con la DB...');
    try {
      const response = await dbConnector.getActiveGames();
      
      // Dependiendo del formato de respuesta del backend (puede venir envuelto en .data)
      const activeGamesRaw = Array.isArray(response) ? response : (response?.data || []);
      
      let loadedCount = 0;
      
      for (const gameData of activeGamesRaw) {
        // 1. Rehidratar Partida
        const game = new Game({ id: gameData.id, maxPlayers: gameData.maxPlayers });
        game.phase = gameData.phase || 'waiting';
        game.startedAt = gameData.startedAt || null;
        game.eventQueue = gameData.eventQueue || [];
        
        // 2. Rehidratar Jugadores
        if (gameData.players) {
          for (const [charId, playerData] of Object.entries(gameData.players)) {
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
            
            // 3. Rehidratar Tropas
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
            
            game.addPlayer(player);
          }
        }
        
        gameStore.addGame(game);
        loadedCount++;
      }
      
      console.log(`✅ Sincronización completada. ${loadedCount} partidas rehidratadas en memoria.`);
    } catch (error) {
      console.error('❌ Error al sincronizar el estado inicial desde la DB:', error.message);
      // Lanzamos el error para detener el arranque, no queremos servidor desincronizado
      throw error; 
    }
  }

  /**
   * Inicia el volcado periódico del estado de la memoria a la base de datos.
   * @param {number} intervalMs - Intervalo en milisegundos.
   */
  startPeriodicSync(intervalMs) {
    console.log(`⏱️  Iniciando volcado periódico a PostgreSQL (cada ${intervalMs}ms)`);
    
    setInterval(async () => {
      const games = gameStore.getAll();
      if (games.length === 0) return; // No hay nada que volcar
      
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
