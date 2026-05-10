import { dbConnector } from '../db/db-connector.js';
import { redisConnector } from '../db/redis-connector.js';
import { gameStore } from '../game/state/game-store.js';
import { logger } from '../utils/logger.js';

/**
 * Devuelve estadísticas globales para el dashboard de administrador.
 * Combina datos persistentes de la DB con métricas en vivo de la memoria del Middle.
 */
export const getAdminStatsController = async (req, res) => {
  try {
    // 1. Obtener datos de la DB
    const dbStatsResponse = await dbConnector.getAdminStats();
    const dbStats = dbStatsResponse?.data || dbStatsResponse || {};

    // 2. Obtener métricas en vivo
    const activeUsers = req.app.get('io')?.engine.clientsCount || 0;
    const activeGames = gameStore.getAll().length;

    // TODO: finishedGamesLastHour y serverLoad podrían calcularse con más detalle
    const monitoringMetrics = {
      activeUsers,
      activeGames,
      finishedGamesLastHour: 0, 
      serverLoad: Math.round(process.cpuUsage().user / 100000) % 100 // Dummy load
    };

    res.json({
      globalStats: dbStats,
      monitoringMetrics
    });
  } catch (error) {
    logger.error({ err: error.message }, '[Admin] Error al obtener estadísticas');
    res.status(500).json({ message: 'Error al obtener estadísticas del sistema' });
  }
};

/**
 * Lista todos los usuarios (proxy a DB Server).
 */
export const listUsersController = async (req, res) => {
  try {
    const response = await dbConnector.getAllUsers();
    const users = response?.data || response || [];
    res.json(users);
  } catch (error) {
    logger.error({ err: error.message }, '[Admin] Error al listar usuarios');
    res.status(500).json({ message: 'Error al listar usuarios' });
  }
};

/**
 * Banea a un usuario (proxy a DB Server).
 */
export const banUserController = async (req, res) => {
  try {
    const { id } = req.params;
    await dbConnector.banUser(id);

    // 1. Añadir a la lista de baneados en Redis (TTL 2 horas para cubrir expiración de JWTs)
    // Usamos el ID del usuario como clave en el set de baneados
    await redisConnector.client.sAdd('banned_users', id);
    await redisConnector.client.expire('banned_users', 7200); // 2h

    // 2. Localizar y desconectar sockets del usuario
    const io = req.app.get('io');
    if (io) {
      const sockets = await io.fetchSockets();
      for (const socket of sockets) {
        if (socket.user?.userId === id) {
          logger.info({ userId: id, socketId: socket.id }, '[Admin] Desconectando socket de usuario baneado');
          socket.emit('user:banned', { message: 'Has sido baneado del sistema' });
          socket.disconnect(true);
        }
      }
    }

    res.status(204).send();
  } catch (error) {
    logger.error({ err: error.message, userId: req.params.id }, '[Admin] Error al banear usuario');
    res.status(500).json({ message: 'Error al banear usuario' });
  }
};

/**
 * Desbanea a un usuario (proxy a DB Server).
 */
export const unbanUserController = async (req, res) => {
  try {
    const { id } = req.params;
    await dbConnector.unbanUser(id);
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error.message, userId: req.params.id }, '[Admin] Error al desbanear usuario');
    res.status(500).json({ message: 'Error al desbanear usuario' });
  }
};
