import { gameData } from '../config/game-data-loader.js';

/**
 * Controlador de Clanes (HTTP REST)
 * Proporciona la configuración completa de todos los clanes para el Frontend.
 * Incluye estadísticas, tropas iniciales y árboles tecnológicos.
 */
export const getClansController = async (req, res, next) => {
  try {
    // gameData es un objeto indexado por ID, devolvemos un array para el frontend
    const clansArray = Object.values(gameData);
    
    console.log(`[HTTP] Servidos ${clansArray.length} clanes dinámicos.`);
    
    return res.status(200).json(clansArray);
  } catch (error) {
    next(error);
  }
};
