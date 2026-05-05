import { checkJoinGameRateLimit } from '../middleware/rate-limiter.js';
import { gameStore } from '../game/state/game-store.js';
import { startGame } from '../game/actions/game-actions.js';
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
    // Evento: disconnect
    // -------------------------------------------------------------------------
    socket.on('disconnect', (reason) => {
      console.log(`[Socket] Jugador desconectado: ${username ?? 'Desconocido'} (Motivo: ${reason})`);
    });
  });
};
