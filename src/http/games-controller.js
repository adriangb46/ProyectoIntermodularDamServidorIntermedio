import { gameStore } from '../game/state/game-store.js';

/**
 * Devuelve la lista de clanes ya ocupados en una partida específica.
 * Permite al frontend marcar esos clanes como no disponibles al unirse.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const getGameAvailabilityController = (req, res) => {
  const { code } = req.params;

  // Buscar la partida en el almacén de memoria
  const game = gameStore.getGame(code);

  if (!game) {
    return res.status(404).json({
      code: 'GAME_NOT_FOUND',
      message: 'No se encontró ninguna partida con ese código'
    });
  }

  // game.players es un objeto { [characterId]: Player }
  const takenClans = Object.values(game.players).map(p => p.clanId);

  return res.json({
    code,
    takenClans
  });
};
