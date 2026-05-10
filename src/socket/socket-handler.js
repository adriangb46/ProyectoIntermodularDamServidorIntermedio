import { checkJoinGameRateLimit } from '../middleware/rate-limiter.js';
import { gameStore } from '../game/state/game-store.js';
import { startGame, launchAttack, trainTroop, startResearch, abandonGame } from '../game/actions/game-actions.js';
import { checkVictory } from '../game/engine/victory-checker.js';
import { config } from '../config/index.js';
import { buildGameView } from '../game/engine/fog-of-war.js';
import { dbConnector } from '../db/db-connector.js';
import { Player } from '../models/player.js';
import { Game } from '../models/game.js';
import { logger } from '../utils/logger.js';
import { sanitizeInput } from '../utils/sanitizer.js';

/**
 * Envía el estado actualizado de la partida a todos los jugadores conectados,
 * aplicando las reglas de Fog of War de forma individualizada.
 *
 * @param {import('socket.io').Server} io
 * @param {import('../models/game').Game} game
 */
export const syncGameStateToAll = (io, game) => {
  for (const player of Object.values(game.players)) {
    if (player.connectedSocketId) {
      const view = buildGameView(game, player.characterId);
      io.to(player.connectedSocketId).emit('game:state-sync', { 
        ...view, 
        myCharacterId: player.characterId 
      });
    }
  }
};

/**
 * Inicializa los manejadores de eventos principales de Socket.IO.
 * Recibe el timeWheel para poder programar eventos desde los handlers.
 *
 * @param {import('socket.io').Server}              io        - Instancia del servidor de WebSockets.
 * @param {import('../game/engine/time-wheel').TimeWheel} timeWheel - Motor de tiempo centralizado.
 */
export const initSocketHandler = (io, timeWheel) => {
  io.on('connection', (socket) => {
    // socket.user fue inyectado previamente por el middleware auth.js
    const { userId, username } = socket.user ?? {};
    logger.info({ username, socketId: socket.id }, '[Socket] Nuevo jugador conectado');

    // -------------------------------------------------------------------------
    // Evento: join_game
    // El jugador se une a la sala de una partida para recibir sus eventos.
    // -------------------------------------------------------------------------
    socket.on('join_game', async (payload) => {
      payload = sanitizeInput(payload);
      const { gameId, clanId } = payload || {};

      // Rate limiting por IP para el evento join_game (security.md §3)
      const socketIp = socket.handshake.address;
      const allowed = await checkJoinGameRateLimit(socketIp);
      if (!allowed) {
        socket.emit('game:error', { message: 'Demasiados intentos de unión. Inténtalo de nuevo más tarde.' });
        return;
      }

      if (!gameId) {
        logger.warn({ username }, '[Socket] Jugador intentó unirse a una partida sin gameId');
        socket.emit('game:error', { message: 'gameId requerido para unirse a una partida.' });
        return;
      }

      // No unirse a la sala todavía, esperar a encontrar la partida para usar el UUID completo
      // const roomName = `game_${gameId}`;
      // socket.join(roomName);

      // Registrar el socketId en el modelo del jugador para permitir emisiones individuales (Fog of War)
      let game = gameStore.getGame(gameId);
      if (!game) {
        // Intentar buscar por código corto si no se encontró por UUID completo
        game = gameStore.getGameByShortId(gameId);
      }

      if (game) {
        // Encontrar al personaje vinculado a este usuario en esta partida
        let player = Object.values(game.players).find(p => p.userId === userId);
        
        // Si el jugador no está en la partida pero envió un clanId (que puede ser el arquetipo) -> Intentamos unirlo
        if (!player && clanId) {
          try {
            // Mapeo de arquetipo (FURY, DIVINE...) a clanId real (berserkers, valkirias...) si es necesario
            const archetypeToClan = {
              'FURY': 'berserkers',
              'DIVINE': 'valkirias',
              'IRON': 'jarls',
              'SHADOW': 'sombras',
              'FROST': 'frost_guard',
              'STORM': 'storm_bringers'
            };
            const realClanId = archetypeToClan[clanId.toUpperCase()] || clanId.toLowerCase();

            // Si el usuario ya está en la partida con otro personaje y estamos en waiting, lo eliminamos
            // para permitir el cambio de clan sin dejar "fantasmas"
            const existingPlayer = Object.values(game.players).find(p => p.userId === userId);
            if (existingPlayer && game.phase === 'waiting') {
              logger.info({ username, oldClan: existingPlayer.clanId, newClan: realClanId }, '[Socket] Reemplazando personaje previo por cambio de clan');
              game.removePlayer(existingPlayer.characterId);
            }

            // 1. Obtener/Crear personaje
            const charsResponse = await dbConnector.getCharactersByUser(userId);
            const characters = charsResponse?.data || charsResponse || [];
            let character = characters.find(c => c.clanId === realClanId);
            if (!character) {
              const newCharResponse = await dbConnector.createCharacter({
                userId, clanId: realClanId, name: `${username} of ${realClanId}`
              });
              character = newCharResponse?.data || newCharResponse;
            }

            // 2. Unirse en DB
            await dbConnector.joinGame(gameId, character.id);

            // 3. Añadir a memoria
            player = new Player({
              characterId: character.id,
              userId, username, clanId: realClanId,
              capitalHealth: 3000, // Salud base MVP
              isHost: false
            });
            game.addPlayer(player);
            logger.info({ username, gameId, clanId }, '[Socket] Jugador se ha unido a la partida');
          } catch (err) {
            logger.error({ err: err.message }, '[Socket Error] auto-join in join_game');
            return socket.emit('game:error', { message: 'No se pudo unir a la partida: ' + err.message });
          }
        }

        if (player) {
          const charId = player.characterId;
          socket.characterId = charId; // Lo guardamos en el socket para otros eventos
          player.username = username; // Asegurar que el username está presente para el Fog of War
          player.connectedSocketId = socket.id;
          
          // Unirse a la sala usando el ID real de la partida (UUID completo)
          const realRoomName = `game_${game.id}`;
          socket.join(realRoomName);
          
          logger.info({ username, roomName: realRoomName }, '[Socket] Jugador se ha unido a la sala');

          // Sincronizar estado para TODOS los participantes de la partida
          syncGameStateToAll(io, game);
        } else {
          logger.warn({ username, gameId }, '[Socket] Jugador no encontrado en la partida');
          socket.emit('game:error', { message: 'No eres participante de esta partida.' });
        }
      } else {
        socket.emit('game:error', { message: 'Partida no encontrada en memoria.' });
      }
    });
    
    // -------------------------------------------------------------------------
    // Evento: game:create
    // Crea una nueva partida y se une a ella.
    // -------------------------------------------------------------------------
    socket.on('game:create', async (payload) => {
      payload = sanitizeInput(payload);
      try {
        const { clanId } = payload || {};
        if (!clanId) return socket.emit('game:error', { message: 'clanId requerido' });

        // 1. Obtener/Crear personaje en DB Server
        const charsResponse = await dbConnector.getCharactersByUser(userId);
        const characters = charsResponse?.data || charsResponse || [];
        let character = characters.find(c => c.clanId === clanId);

        if (!character) {
          const newCharResponse = await dbConnector.createCharacter({
            userId, clanId, name: `${username} of ${clanId}`
          });
          character = newCharResponse?.data || newCharResponse;
        }

        // 2. Crear partida en DB Server
        const gameCreateResponse = await dbConnector.createGame({
          maxPlayers: 6,
          characterIds: [character.id]
        });
        const gameDto = gameCreateResponse?.data || gameCreateResponse;

        // 3. Rehidratar en memoria
        const newGame = new Game({ id: gameDto.id, maxPlayers: gameDto.maxPlayers });
        const hostPlayer = new Player({
          characterId: character.id,
          userId, username, clanId,
          capitalHealth: 3000,
          isHost: true
        });
        newGame.addPlayer(hostPlayer);
        gameStore.addGame(newGame);

        // 4. Unirse a la sala y confirmar
        const roomName = `game_${gameDto.id}`;
        socket.join(roomName);
        socket.characterId = character.id;
        hostPlayer.connectedSocketId = socket.id;

        socket.emit('game:created', gameDto);
        
        // Enviar estado inicial sincronizado
        syncGameStateToAll(io, newGame);

        logger.info({ gameId: gameDto.id, username }, '[Socket] Partida creada');
      } catch (err) {
        logger.error({ err: err.message, username }, '[Socket] Error al crear partida');
        socket.emit('game:error', { message: 'Fallo al crear partida' });
      }
    });

    // -------------------------------------------------------------------------
    socket.on('game:list', async () => {
      try {
        // 1. Obtener partidas de la base de datos (historial y persistencia)
        const dbResponse = await dbConnector.getGamesByUser(userId);
        const dbGames = dbResponse?.data || dbResponse || [];

        // 2. Obtener partidas vivas en memoria del Middle Server
        // Filtramos las partidas donde el usuario actual es un participante
        const memoryGames = gameStore.getAll()
          .filter(game => Object.values(game.players).some(p => p.userId === userId))
          .map(game => {
            const player = Object.values(game.players).find(p => p.userId === userId);
            return {
              id: game.id,
              status: game.phase.toUpperCase(),
              maxPlayers: game.maxPlayers,
              createdAt: game.startedAt ? new Date(game.startedAt).toISOString() : new Date().toISOString(),
              participants: Object.values(game.players).map(p => ({
                characterId: p.characterId,
                userId: p.userId,
                username: p.username,
                clanId: p.clanId, // <--- Incluimos el clanId para que el lobby lo sepa
                isHost: p.isHost
              })),
              // Proporcionamos el estado vivo para que el lobby sea 100% fiel a la memoria
              latestStateJson: JSON.stringify(game.toJSON())
            };
          });

        // 3. Fusionar: las partidas en memoria tienen prioridad absoluta sobre la DB
        const mergedGamesMap = new Map();
        
        // Primero metemos las de DB
        dbGames.forEach(g => mergedGamesMap.set(g.id, g));
        
        // Sobrescribimos con las de memoria (que están más actualizadas)
        memoryGames.forEach(g => mergedGamesMap.set(g.id, g));

        const finalGamesList = Array.from(mergedGamesMap.values());
        socket.emit('game:list-results', finalGamesList);
      } catch (err) {
        logger.error({ err: err.message, userId }, '[Socket] Error al listar partidas');
        socket.emit('game:error', { message: 'Fallo al listar partidas' });
      }
    });

    // -------------------------------------------------------------------------
    // Evento: game:availability
    // Consulta clanes ocupados en una partida.
    // -------------------------------------------------------------------------
    socket.on('game:availability', (payload) => {
      payload = sanitizeInput(payload);
      const { gameId } = payload || {};
      let game = gameStore.getGame(gameId);
      if (!game) {
        game = gameStore.getGameByShortId(gameId);
      }

      if (!game) return socket.emit('game:error', { message: 'Partida no encontrada' });

      const takenClans = Object.values(game.players).map(p => p.clanId);
      socket.emit('game:availability-results', { gameId, takenClans });
    });

    // -------------------------------------------------------------------------
    // Evento: game:start
    // Solo el host puede emitir este evento para iniciar la partida.
    // Mueve la partida de `waiting` → `preparation` y programa PHASE_TRANSITION_WAR.
    // -------------------------------------------------------------------------
    socket.on('game:start', (payload) => {
      payload = sanitizeInput(payload);
      const { gameId } = payload || {};

      // 1. Validar payload mínimo (security.md §4)
      if (!gameId || typeof gameId !== 'string') {
        socket.emit('game:error', { message: 'gameId inválido o ausente.' });
        return;
      }

      // 2. Verificar que el socket pertenece a esa sala (el jugador hizo join_game previamente)
      const roomName = `game_${gameId}`;
      if (!socket.rooms.has(roomName)) {
        socket.emit('game:error', { message: 'No estás en la sala de esa partida.' });
        return;
      }

      // 3. Recuperar la partida del GameStore (security.md §5: gameId membership server-side)
      const game = gameStore.getGame(gameId);
      if (!game) {
        socket.emit('game:error', { message: 'Partida no encontrada.' });
        return;
      }

      // 4. socket.characterId viene del JWT (inyectado en socket.user por el middleware auth.js)
      if (!socket.characterId) {
        socket.emit('game:error', { message: 'No se pudo identificar tu personaje. Vuelve a conectarte.' });
        return;
      }

      // 5. Delegar en la lógica de negocio (game-actions.js)
      const result = startGame(game, socket.characterId, timeWheel, config.preparationDurationMs);

      if (!result.success) {
        socket.emit('game:error', { message: result.message });
        return;
      }

      // 6. Notificar a los jugadores de la sala que la partida ha comenzado
      io.to(roomName).emit('game:phase-changed', {
        gameId,
        newPhase: 'PREPARATION',
        warStartsAt: result.warStartsAt,
      });

      // Sincronizar estado completo
      syncGameStateToAll(io, game);

      logger.info({ gameId, username }, '[Socket] Partida iniciada');
    });

    // -------------------------------------------------------------------------
    // Evento: game:attack
    // El jugador despliega tropas seleccionadas hacia la capital de un rival.
    // Payload: { gameId, targetCharacterId, troopIds: string[] }
    // -------------------------------------------------------------------------
    socket.on('game:attack', (payload) => {
      payload = sanitizeInput(payload);
      const { gameId, targetCharacterId, troopIds } = payload || {};

      // 1. Validar campos obligatorios (security.md §4)
      if (!gameId || typeof gameId !== 'string') {
        socket.emit('game:error', { message: 'gameId inválido o ausente.' });
        return;
      }
      if (!targetCharacterId || typeof targetCharacterId !== 'string') {
        socket.emit('game:error', { message: 'targetCharacterId inválido o ausente.' });
        return;
      }
      if (!Array.isArray(troopIds) || troopIds.length === 0) {
        socket.emit('game:error', { message: 'Debes enviar al menos un ID de tropa en troopIds.' });
        return;
      }

      // 2. Verificar que el socket está en la sala de la partida
      const roomName = `game_${gameId}`;
      if (!socket.rooms.has(roomName)) {
        socket.emit('game:error', { message: 'No estás en la sala de esa partida.' });
        return;
      }

      // 3. Obtener la partida del GameStore (security.md §5)
      let game = gameStore.getGame(gameId);
      if (!game) {
        game = gameStore.getGameByShortId(gameId);
      }
      if (!game) {
        socket.emit('game:error', { message: 'Partida no encontrada.' });
        return;
      }

      // 4. socket.characterId proviene del JWT, nunca del payload del cliente
      if (!socket.characterId) {
        socket.emit('game:error', { message: 'No se pudo identificar tu personaje. Vuelve a conectarte.' });
        return;
      }

      // 5. Delegar en la lógica de negocio
      const result = launchAttack(game, socket.characterId, targetCharacterId, troopIds, timeWheel);

      if (!result.success) {
        socket.emit('game:error', { message: result.message });
        return;
      }

      // 6. Confirmar al atacante con el timestamp de llegada
      const targetPlayer = game.getPlayer(targetCharacterId);
      socket.emit('game:attack-launched', {
        arrivalAt: result.arrivalAt,
        troopCount: troopIds.length,
        fromPlayer: username,
        toPlayer: targetPlayer ? targetPlayer.username : 'Desconocido',
        fromCharacterId: socket.characterId,
        toCharacterId: targetCharacterId
      });

      // Sincronizar estado completo
      syncGameStateToAll(io, game);

      // 7. Notificar a toda la sala que hay tropas en movimiento
      // (Se revela el origen y el destino para que el frontend dibuje las animaciones y el log de batalla)
      io.to(roomName).emit('game:troop-deployed', {
        troopCount: troopIds.length,
        arrivalAt: result.arrivalAt,
        fromPlayer: username,
        toPlayer: targetPlayer ? targetPlayer.username : 'Desconocido',
        fromCharacterId: socket.characterId,
        toCharacterId: targetCharacterId
      });

      logger.info({ attacker: socket.characterId, target: targetCharacterId, count: troopIds.length }, '[Socket] Ataque lanzado');
    });

    // -------------------------------------------------------------------------
    // Evento: game:train
    // El jugador añade una tropa a la cola de entrenamiento.
    // Payload: { gameId, troopTypeId }
    // -------------------------------------------------------------------------
    socket.on('game:train', (payload) => {
      payload = sanitizeInput(payload);
      const { gameId, troopTypeId } = payload || {};

      // 1. Validar campos obligatorios (security.md §4)
      if (!gameId || typeof gameId !== 'string') {
        socket.emit('game:error', { message: 'gameId inválido o ausente.' });
        return;
      }
      if (!troopTypeId || typeof troopTypeId !== 'string') {
        socket.emit('game:error', { message: 'troopTypeId inválido o ausente.' });
        return;
      }

      // 2. Verificar que el socket está en la sala de la partida
      const roomName = `game_${gameId}`;
      if (!socket.rooms.has(roomName)) {
        socket.emit('game:error', { message: 'No estás en la sala de esa partida.' });
        return;
      }

      // 3. Recuperar la partida del GameStore (security.md §5)
      const game = gameStore.getGame(gameId);
      if (!game) {
        socket.emit('game:error', { message: 'Partida no encontrada.' });
        return;
      }

      // 4. socket.characterId proviene del JWT, nunca del payload del cliente
      if (!socket.characterId) {
        socket.emit('game:error', { message: 'No se pudo identificar tu personaje. Vuelve a conectarte.' });
        return;
      }

      // 5. Delegar en la lógica de negocio
      const result = trainTroop(game, socket.characterId, troopTypeId, timeWheel);

      if (!result.success) {
        socket.emit('game:error', { message: result.message });
        return;
      }

      // 6. Confirmar al jugador: cola de entrenamiento actualizada y créditos descontados
      const player = game.getPlayer(socket.characterId);
      socket.emit('player:train-queued', {
        troopTypeId,
        completesAt: result.completesAt,
        trainingQueue: player.trainingQueue,
        economicCredits: player.economicCredits,
      });

      // Sincronizar estado completo
      syncGameStateToAll(io, game);

      logger.info({ username, troopTypeId }, '[Socket] Entrenamiento encolado');
    });

    // -------------------------------------------------------------------------
    // Evento: game:research
    // El jugador inicia una investigación tecnológica.
    // Payload: { gameId, researchId }
    // -------------------------------------------------------------------------
    socket.on('game:research', (payload) => {
      payload = sanitizeInput(payload);
      const { gameId, researchId } = payload || {};

      // 1. Validar campos obligatorios (security.md §4)
      if (!gameId || typeof gameId !== 'string') {
        socket.emit('game:error', { message: 'gameId inválido o ausente.' });
        return;
      }
      if (!researchId || typeof researchId !== 'string') {
        socket.emit('game:error', { message: 'researchId inválido o ausente.' });
        return;
      }

      // 2. Verificar que el socket está en la sala de la partida
      const roomName = `game_${gameId}`;
      if (!socket.rooms.has(roomName)) {
        socket.emit('game:error', { message: 'No estás en la sala de esa partida.' });
        return;
      }

      // 3. Recuperar la partida del GameStore (security.md §5)
      const game = gameStore.getGame(gameId);
      if (!game) {
        socket.emit('game:error', { message: 'Partida no encontrada.' });
        return;
      }

      // 4. socket.characterId proviene del JWT, nunca del payload del cliente
      if (!socket.characterId) {
        socket.emit('game:error', { message: 'No se pudo identificar tu personaje. Vuelve a conectarte.' });
        return;
      }

      // 5. Delegar en la lógica de negocio
      const result = startResearch(game, socket.characterId, researchId, timeWheel);

      if (!result.success) {
        socket.emit('game:error', { message: result.message });
        return;
      }

      // 6. Confirmar al jugador: investigación en curso y créditos descontados
      const player = game.getPlayer(socket.characterId);
      socket.emit('player:research-started', {
        researchId,
        researchInProgress: player.researchInProgress,
        researchCredits: player.researchCredits,
      });

      // Sincronizar estado completo
      syncGameStateToAll(io, game);

      logger.info({ username, researchId }, '[Socket] Investigación iniciada');
    });

    // -------------------------------------------------------------------------
    // Evento: game:abandon
    // El jugador abandona la partida, marcándose como eliminado y su capital a 0.
    // -------------------------------------------------------------------------
    socket.on('game:abandon', (payload) => {
      payload = sanitizeInput(payload);
      const { gameId } = payload || {};

      if (!gameId || typeof gameId !== 'string') {
        socket.emit('game:error', { message: 'gameId inválido o ausente.' });
        return;
      }

      // Buscar partida (soporta UUID o short ID)
      let game = gameStore.getGame(gameId);
      if (!game) {
        game = gameStore.getGameByShortId(gameId);
      }

      if (!game) {
        socket.emit('game:error', { message: 'Partida no encontrada.' });
        return;
      }

      // Identificar personaje: por socket (si ya hizo join_game) o por userId del JWT
      let charId = socket.characterId;
      if (!charId) {
        const player = Object.values(game.players).find(p => p.userId === userId);
        charId = player?.characterId;
      }

      if (!charId) {
        socket.emit('game:error', { message: 'No se pudo identificar tu personaje en esta partida.' });
        return;
      }

      // Aplicar lógica de negocio de abandono
      const result = abandonGame(game, charId);

      if (!result.success) {
        socket.emit('game:error', { message: result.message });
        return;
      }

      const roomName = `game_${game.id}`;

      // Notificar a los demás según el resultado
      if (!result.removed) {
        // En fases iniciadas (preparation, war, end), el jugador es marcado como eliminado
        checkVictory(game, io);
        io.to(roomName).emit('game:player-eliminated', {
          characterId: charId,
          username,
          reason: 'abandoned'
        });
      }

      // Sincronizar estado a todos los que queden conectados
      syncGameStateToAll(io, game);

      // Si la partida se queda vacía, eliminarla de memoria
      if (Object.keys(game.players).length === 0) {
        gameStore.removeGame(game.id);
        logger.info({ gameId: game.id }, '[Socket] Partida eliminada de memoria por quedarse sin jugadores');
      }

      logger.info({ username, gameId: game.id, charId }, '[Socket] Jugador abandonó la partida');
      
      // Salir de la sala si estaba en ella
      socket.leave(roomName);
    });

    // -------------------------------------------------------------------------
    // Evento: lobby:leave
    // El jugador abandona una partida en fase `waiting` desde el lobby.
    // No requiere que el socket esté en la sala (nunca hizo join_game desde el lobby).
    // -------------------------------------------------------------------------
    socket.on('lobby:leave', async (payload) => {
      payload = sanitizeInput(payload);
      const { gameId } = payload || {};

      if (!gameId || typeof gameId !== 'string') {
        socket.emit('lobby:leave-error', { message: 'gameId inválido o ausente.' });
        return;
      }

      // Buscar partida (soporta UUID o short ID)
      let game = gameStore.getGame(gameId);
      if (!game) {
        game = gameStore.getGameByShortId(gameId);
      }

      if (!game) {
        logger.warn({ username, gameId }, '[Socket] lobby:leave: partida no encontrada');
        socket.emit('lobby:left', { gameId });
        return;
      }

      // Identificar jugador por userId del JWT
      const player = Object.values(game.players).find(p => p.userId === userId);
      if (!player) {
        socket.emit('lobby:left', { gameId });
        return;
      }

      const charId = player.characterId;

      // Aplicar lógica de negocio de abandono (independiente de la fase)
      const result = abandonGame(game, charId);
      
      if (!result.success) {
        socket.emit('lobby:leave-error', { message: result.message });
        return;
      }

      logger.info({ username, gameId: game.id, charId }, '[Socket] Jugador abandonó vía lobby');

      const roomName = `game_${game.id}`;

      // Notificar a los demás según el resultado
      if (!result.removed) {
        // En fases iniciadas, el jugador es marcado como eliminado
        checkVictory(game, io);
        io.to(roomName).emit('game:player-eliminated', {
          characterId: charId,
          username,
          reason: 'abandoned'
        });
      }

      // Sincronizar estado total a la sala (si hay alguien dentro)
      syncGameStateToAll(io, game);

      // Si la partida se queda vacía, eliminarla de memoria
      if (Object.keys(game.players).length === 0) {
        gameStore.removeGame(game.id);
        logger.info({ gameId: game.id }, '[Socket] Partida eliminada por falta de jugadores');
      }

      // Confirmar al cliente que abandona
      socket.emit('lobby:left', { gameId });
      
      // Asegurar que sale de la sala si estaba en ella
      socket.leave(roomName);
    });

    // -------------------------------------------------------------------------
    // Evento: game:send-log
    // Retransmite un log generado por un cliente a todos los jugadores de la sala.
    // -------------------------------------------------------------------------
    socket.on('game:send-log', (payload) => {
      payload = sanitizeInput(payload);
      const { gameId, logEntry } = payload || {};
      
      if (!gameId || !logEntry) return;

      const roomName = `game_${gameId}`;
      if (!socket.rooms.has(roomName)) return; // Validar que el socket pertenece a la sala

      // Retransmitir a toda la sala
      io.to(roomName).emit('game:new-log', logEntry);
    });

    // -------------------------------------------------------------------------
    // Evento: disconnect
    // -------------------------------------------------------------------------
    socket.on('disconnect', (reason) => {
      logger.info({ username, reason }, '[Socket] Jugador desconectado');
    });
  });
};
