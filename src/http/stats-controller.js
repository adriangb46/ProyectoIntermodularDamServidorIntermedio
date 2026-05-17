import { dbConnector } from '../db/db-connector.js';
import { logger } from '../utils/logger.js';

/**
 * Recupera las estadísticas históricas de un usuario desde la DB.
 */
export const getUserStatsController = async (req, res) => {
  try {
    const { userId } = req.user; // Inyectado por middleware auth
    const { gameId } = req.query;

    let statsResponse;
    if (gameId) {
      statsResponse = await dbConnector.getMatchStats(gameId, userId);
    } else {
      statsResponse = await dbConnector.getUserStats(userId);
    }

    const stats = statsResponse?.data || statsResponse || {};
    res.json(stats);
  } catch (error) {
    logger.error({ err: error.message, userId: req.user?.userId, gameId: req.query?.gameId }, '[Stats] Error al obtener estadísticas');
    res.status(500).json({ message: 'Error al recuperar las estadísticas' });
  }
};

/**
 * Recupera el ranking público de los 3 mejores jugadores.
 */
export const getRankingController = async (req, res) => {
  try {
    const rankingResponse = await dbConnector.getRanking();
    const ranking = rankingResponse?.data || rankingResponse || [];
    res.json(ranking);
  } catch (error) {
    logger.error({ err: error.message }, '[Stats] Error al obtener el ranking público');
    res.status(500).json({ message: 'Error al recuperar el ranking' });
  }
};
