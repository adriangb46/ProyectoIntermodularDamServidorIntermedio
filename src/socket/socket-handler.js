import { checkJoinGameRateLimit } from '../middleware/rate-limiter.js';
import { gameStore } from '../game/state/game-store.js';
import { startGame, launchAttack } from '../game/actions/game-actions.js';
import { config } from '../config/index.js';

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
    const { characterId, username } = socket.user ?? {};
    console.log(`[Socket] Nuevo jugador conectado: ${username ?? 'Desconocido'} (Socket ID: ${socket.id})`);

    // -------------------------------------------------------------------------
    // Evento: join_game
    // El jugador se une a la sala de una partida para recibir sus eventos.
    // -------------------------------------------------------------------------
    socket.on('join_game', async (payload) => {
      const { gameId } = payload || {};

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
      console.log(`[Socket] Jugador ${username} se ha unido a la sala: ${roomName}`);

      // TODO: Enviar el estado actual de la partida al jugador recién unido
      // socket.emit('game:state-sync', game.toJSON());
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

      // 4. characterId viene del JWT (inyectado en socket.user por el middleware auth.js)
      if (!characterId) {
        socket.emit('game:error', { message: 'No se pudo identificar tu personaje. Vuelve a conectarte.' });
        return;
      }

      // 5. Delegar en la lógica de negocio (game-actions.js)
      const result = startGame(game, characterId, timeWheel, config.preparationDurationMs);

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

      // 4. characterId proviene del JWT, nunca del payload del cliente
      if (!characterId) {
        socket.emit('game:error', { message: 'No se pudo identificar tu personaje. Vuelve a conectarte.' });
        return;
      }

      // 5. Delegar en la lógica de negocio
      const result = launchAttack(game, characterId, targetCharacterId, troopIds, timeWheel);

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
        attackerCharacterId: characterId,
        troopCount: troopIds.length,
      });

      console.log(
        `[Socket] Ataque lanzado por ${username} (${characterId}) → ${targetCharacterId}. ` +
        `Sala: ${roomName}.`
      );
    });

    // -------------------------------------------------------------------------
    // Evento: disconnect
    // -------------------------------------------------------------------------
    socket.on('disconnect', (reason) => {
      console.log(`[Socket] Jugador desconectado: ${username ?? 'Desconocido'} (Motivo: ${reason})`);
    });
  });
};
