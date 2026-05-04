import { gameStore } from '../game/state/game-store.js';
import { dbConnector } from '../connectors/db-connector.js';
import { syncManager } from '../game/state/sync-manager.js';

/**
 * Devuelve la lista de clanes ya ocupados en una partida específica.
 * Permite al frontend marcar esos clanes como no disponibles al unirse.
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

/**
 * Devuelve todas las partidas en las que participa el usuario autenticado.
 */
export const getMyGamesController = async (req, res, next) => {
  try {
    const { userId } = req.user; // Inyectado por el middleware de auth

    if (!userId) {
      return res.status(401).json({ message: "Sesión inválida" });
    }

    const response = await dbConnector.getGamesByUser(userId);
    const games = response?.data || response || [];

    return res.json(games);
  } catch (error) {
    next(error);
  }
};

/**
 * Crea una nueva partida para el usuario.
 * Crea un personaje si el usuario no tiene uno para el clan elegido.
 */
export const createGameController = async (req, res, next) => {
  try {
    const { userId, sub: username } = req.user;
    const { clanId } = req.body; // ej: 'FURY'

    if (!clanId) {
      return res.status(400).json({ message: "El clan es requerido" });
    }

    // 1. Obtener personajes del usuario para ver si ya tiene uno para este clan
    const charsResponse = await dbConnector.getCharactersByUser(userId);
    const characters = charsResponse?.data || charsResponse || [];
    
    let character = characters.find(c => c.clanId === clanId);

    // 2. Si no tiene personaje para ese clan, lo creamos
    if (!character) {
      const newCharResponse = await dbConnector.createCharacter({
        userId,
        clanId,
        name: `${username} of ${clanId}`
      });
      character = newCharResponse?.data || newCharResponse;
    }

    // 3. Crear la partida en el DB Server
    // Por ahora creamos partidas de 6 jugadores por defecto (MVP)
    const gameCreateResponse = await dbConnector.createGame({
      maxPlayers: 6,
      characterIds: [character.id]
    });
    const gameDto = gameCreateResponse?.data || gameCreateResponse;

    // 4. Rehidratar la partida en la memoria del Middle Server (SyncManager)
    // Usamos el esqueleto porque es una partida nueva (latestStateJson será null)
    // Accedemos a la instancia de syncManager para cargarla.
    // Como _rehydrateFromParticipants es privada pero estamos en el mismo proyecto,
    // podemos invocarla si la exponemos o simplemente dejamos que loadActiveGames
    // la recoja en el próximo ciclo (o forzamos un addGame manual aquí).
    
    // Fallback: Rehidratación manual rápida para disponibilidad inmediata
    const { Game } = await import('../models/game.js');
    const { Player } = await import('../models/player.js');
    
    const newGame = new Game({ id: gameDto.id, maxPlayers: gameDto.maxPlayers });
    newGame.phase = 'waiting';
    
    const hostPlayer = new Player({
      characterId: character.id,
      userId: userId,
      clanId: clanId,
      capitalHealth: 100
    });
    newGame.players[character.id] = hostPlayer;
    
    gameStore.addGame(newGame);

    console.log(`[Game] Nueva partida creada: ${gameDto.id} por usuario ${username}`);

    return res.status(201).json(gameDto);
  } catch (error) {
    next(error);
  }
};
