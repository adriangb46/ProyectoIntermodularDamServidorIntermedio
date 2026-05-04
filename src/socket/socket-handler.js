import { checkJoinGameRateLimit } from '../middleware/rate-limiter.js';

/**
 * Inicializa los manejadores de eventos principales de Socket.IO
 * @param {import('socket.io').Server} io Instancia del servidor de WebSockets
 */
export const initSocketHandler = (io) => {
  io.on('connection', (socket) => {
    // socket.user fue inyectado previamente por el middleware auth.js
    const username = socket.user?.username || 'Desconocido';
    console.log(`[Socket] Nuevo jugador conectado: ${username} (Socket ID: ${socket.id})`);

    // Manejo de la unión a la sala de la partida
    socket.on('join_game', async (payload) => {
      const { gameId } = payload || {};

      // Rate limiting por IP para el evento join_game (security.md §3)
      const socketIp = socket.handshake.address;
      const allowed = await checkJoinGameRateLimit(socketIp);
      if (!allowed) {
        socket.emit('error', { message: 'Demasiados intentos de unión. Inténtalo de nuevo más tarde.' });
        return;
      }

      if (gameId) {
        const roomName = `game_${gameId}`;
        socket.join(roomName);
        console.log(`[Socket] Jugador ${username} se ha unido a la sala: ${roomName}`);
        
        // TODO: Enviar el estado actual de la partida al jugador
        // socket.emit('game_state_sync', state);
      } else {
        console.warn(`[Socket] Jugador ${username} intentó unirse a una partida sin gameId`);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] Jugador desconectado: ${username} (Motivo: ${reason})`);
    });
  });
};
