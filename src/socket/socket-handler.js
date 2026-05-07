import { checkJoinGameRateLimit } from '../middleware/rate-limiter.js';
import { gameStore } from '../game/state/game-store.js';
import { startGame, launchAttack, trainTroop, startResearch } from '../game/actions/game-actions.js';
import { config } from '../config/index.js';
import { buildGameView } from '../game/engine/fog-of-war.js';
import { dbConnector } from '../db/db-connector.js';
import { Player } from '../models/player.js';
import { Game } from '../models/game.js';

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
    console.log(`[Socket] Nuevo jugador conectado: ${username ?? 'Desconocido'} (Socket ID: ${socket.id})`);

    // -------------------------------------------------------------------------
    // Evento: join_game
    // El jugador se une a la sala de una partida para recibir sus eventos.
    // -------------------------------------------------------------------------
    socket.on('join_game', async (payload) => {
      const { gameId, clanId } = payload || {};

      // Rate limiting por IP para el evento join_game (security.md §3)
      const socketIp = socket.handshake.address;
      const allowed = await checkJoinGameRateLimit(socketIp);
      if (!allowed) {
        socket.emit('game:error', { message: 'Demasiados intentos de unión. Inténtalo de nuevo más tarde.' });
        return;
      }

      if (!gameId) {
        console.warn(`[Socket] Jugador ${username} intentó unirse a una partida sin gameId`);
        socket.emit('game:error', { message: 'gameId requerido para unirse a una partida.' });
        return;
      }

      const roomName = `game_${gameId}`;
      socket.join(roomName);

      // Registrar el socketId en el modelo del jugador para permitir emisiones individuales (Fog of War)
      const game = gameStore.getGame(gameId);
      if (game) {
        // Encontrar al personaje vinculado a este usuario en esta partida
        let player = Object.values(game.players).find(p => p.userId === userId);
        
        // Si el jugador no está en la partida pero envió un clanId -> Intentamos unirlo
        if (!player && clanId) {
          try {
            // 1. Obtener/Crear personaje
            const charsResponse = await dbConnector.getCharactersByUser(userId);
            const characters = charsResponse?.data || charactersResponse || [];
            let character = characters.find(c => c.clanId === clanId);
            if (!character) {
              const newCharResponse = await dbConnector.createCharacter({
                userId, clanId, name: `${username} of ${clanId}`
              });
              character = newCharResponse?.data || newCharResponse;
            }

            // 2. Unirse en DB
            await dbConnector.joinGame(gameId, character.id);

            // 3. Añadir a memoria
            player = new Player({
              characterId: character.id,
              userId, username, clanId,
              capitalHealth: 3000, // Salud base MVP
              isHost: false
            });
            game.players[character.id] = player;
            console.log(`[Socket] Jugador ${username} se ha unido a la partida ${gameId} con clan ${clanId}`);
          } catch (err) {
            console.error('[Socket Error] auto-join in join_game:', err);
            return socket.emit('game:error', { message: 'No se pudo unir a la partida: ' + err.message });
          }
        }

        if (player) {
          const charId = player.characterId;
          socket.characterId = charId; // Lo guardamos en el socket para otros eventos
          player.username = username; // Asegurar que el username está presente para el Fog of War
          player.connectedSocketId = socket.id;
          
          console.log(`[Socket] Jugador ${username} se ha unido a la sala: ${roomName}`);

          // Emitir estado inicial filtrado por Fog of War: el jugador solo ve lo que le corresponde
          const view = buildGameView(game, charId);
          socket.emit('game:state-sync', { ...view, myCharacterId: charId });
        } else {
          console.warn(`[Socket] Jugador ${username} no encontrado en la partida ${gameId}`);
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
          capitalHealth: 100,
          isHost: true
        });
        newGame.players[character.id] = hostPlayer;
        gameStore.addGame(newGame);

        // 4. Unirse a la sala y confirmar
        const roomName = `game_${gameDto.id}`;
        socket.join(roomName);
        socket.characterId = character.id;
        hostPlayer.connectedSocketId = socket.id;

        socket.emit('game:created', gameDto);
        
        // Enviar estado inicial
        const view = buildGameView(newGame, character.id);
        socket.emit('game:state-sync', { ...view, myCharacterId: character.id });

        console.log(`[Socket] Partida ${gameDto.id} creada por ${username}`);
      } catch (err) {
        console.error('[Socket Error] game:create:', err);
        socket.emit('game:error', { message: 'Fallo al crear partida' });
      }
    });

    // -------------------------------------------------------------------------
    // Evento: game:list
    // Lista las partidas del usuario.
    // -------------------------------------------------------------------------
    socket.on('game:list', async () => {
      try {
        const response = await dbConnector.getGamesByUser(userId);
        socket.emit('game:list-results', response?.data || response || []);
      } catch (err) {
        console.error('[Socket Error] game:list:', err);
        socket.emit('game:error', { message: 'Fallo al listar partidas' });
      }
    });

    // -------------------------------------------------------------------------
    // Evento: game:availability
    // Consulta clanes ocupados en una partida.
    // -------------------------------------------------------------------------
    socket.on('game:availability', (payload) => {
      const { gameId } = payload || {};
      const game = gameStore.getGame(gameId);
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

      // 6. Notificar a TODOS los jugadores de la sala que la partida ha comenzado
      io.to(roomName).emit('game:phase-change', {
        gameId,
        phase: 'preparation',
        warStartsAt: result.warStartsAt,
      });

      console.log(`[Socket] Partida ${gameId} iniciada. Notificación enviada a la sala ${roomName}.`);
    });

    // -------------------------------------------------------------------------
    // Evento: game:attack
    // El jugador despliega tropas seleccionadas hacia la capital de un rival.
    // Payload: { gameId, targetCharacterId, troopIds: string[] }
    // -------------------------------------------------------------------------
    socket.on('game:attack', (payload) => {
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
      const result = launchAttack(game, socket.characterId, targetCharacterId, troopIds, timeWheel);

      if (!result.success) {
        socket.emit('game:error', { message: result.message });
        return;
      }

      // 6. Confirmar al atacante con el timestamp de llegada
      socket.emit('game:attack-launched', {
        arrivalAt: result.arrivalAt,
        troopCount: troopIds.length,
      });

      // 7. Notificar a toda la sala que hay tropas en movimiento
      // (Fog of War: no se revela el objetivo ni qué tropas se enviaron)
      io.to(roomName).emit('game:troop-deployed', {
        attackerCharacterId: socket.characterId,
        troopCount: troopIds.length,
      });

      console.log(
        `[Socket] Ataque lanzado por ${username} (${socket.characterId}) → ${targetCharacterId}. ` +
        `Sala: ${roomName}.`
      );
    });

    // -------------------------------------------------------------------------
    // Evento: game:train
    // El jugador añade una tropa a la cola de entrenamiento.
    // Payload: { gameId, troopTypeId }
    // -------------------------------------------------------------------------
    socket.on('game:train', (payload) => {
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

      console.log(`[Socket] ${username} (${socket.characterId}) encoló entrenamiento: ${troopTypeId}.`);
    });

    // -------------------------------------------------------------------------
    // Evento: game:research
    // El jugador inicia una investigación tecnológica.
    // Payload: { gameId, researchId }
    // -------------------------------------------------------------------------
    socket.on('game:research', (payload) => {
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

      console.log(`[Socket] ${username} (${socket.characterId}) inició investigación: ${researchId}.`);
    });

    // -------------------------------------------------------------------------
    // Evento: disconnect
    // -------------------------------------------------------------------------
    socket.on('disconnect', (reason) => {
      console.log(`[Socket] Jugador desconectado: ${username ?? 'Desconocido'} (Motivo: ${reason})`);
    });
  });
};
