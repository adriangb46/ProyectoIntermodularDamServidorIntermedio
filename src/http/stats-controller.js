import { dbConnector } from '../db/db-connector.js';
import { logger } from '../utils/logger.js';

/**
 * Recupera las estadísticas históricas de un usuario desde la DB.
 */
export const getUserStatsController = async (req, res) => {
  try {
    const { userId } = req.user; // Inyectado por middleware auth
    const statsResponse = await dbConnector.getUserStats(userId);
    const stats = statsResponse?.data || statsResponse || {};

    res.json(stats);
  } catch (error) {
    logger.error({ err: error.message, userId: req.user?.userId }, '[Stats] Error al obtener estadísticas de usuario');
    res.status(500).json({ message: 'Error al recuperar tus estadísticas' });
  }
};
