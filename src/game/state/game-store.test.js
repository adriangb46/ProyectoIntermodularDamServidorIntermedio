/**
 * Tests unitarios para GameStore (almacén singleton de partidas en memoria).
 * Cubre: addGame, getGame, getGameByShortId, removeGame, getAll, count,
 *        recordFinishedGame, countFinishedGamesInLastHour.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { gameStore } from './game-store.js';

/** Stub mínimo de partida para los tests */
function makeGameStub(id) {
  return { id };
}

describe('GameStore', () => {
  // Garantizar aislamiento entre tests: el store es un singleton
  beforeEach(() => {
    gameStore.clear();
  });

  // ---------------------------------------------------------------------------
  // addGame / getGame
  // ---------------------------------------------------------------------------
  describe('addGame & getGame', () => {
    it('addGame_givenGame_shouldStoredAndRetrievableById', () => {
      const game = makeGameStub('550e8400-e29b-41d4-a716-446655440000');
      gameStore.addGame(game);
      expect(gameStore.getGame(game.id)).toBe(game);
    });

    it('getGame_givenUnknownId_shouldReturnUndefined', () => {
      expect(gameStore.getGame('no-existe')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getGameByShortId
  // ---------------------------------------------------------------------------
  describe('getGameByShortId', () => {
    it('getGameByShortId_givenValidShortId_shouldReturnGame', () => {
      const game = makeGameStub('abcdef00-0000-0000-0000-000000000000');
      gameStore.addGame(game);
      // El short ID son los primeros 6 caracteres del UUID en mayúsculas
      expect(gameStore.getGameByShortId('ABCDEF')).toBe(game);
    });

    it('getGameByShortId_givenLowercaseShortId_shouldReturnGame', () => {
      const game = makeGameStub('abcdef00-0000-0000-0000-000000000000');
      gameStore.addGame(game);
      expect(gameStore.getGameByShortId('abcdef')).toBe(game);
    });

    it('getGameByShortId_givenFullUUID_shouldReturnGame', () => {
      const game = makeGameStub('abcdef00-0000-0000-0000-000000000000');
      gameStore.addGame(game);
      // Un id con más de 6 caracteres se pasa directamente a getGame
      expect(gameStore.getGameByShortId('abcdef00-0000-0000-0000-000000000000')).toBe(game);
    });

    it('getGameByShortId_givenNull_shouldReturnUndefined', () => {
      expect(gameStore.getGameByShortId(null)).toBeUndefined();
    });

    it('getGameByShortId_givenUnknownShortId_shouldReturnUndefined', () => {
      gameStore.addGame(makeGameStub('abcdef00-0000-0000-0000-000000000000'));
      expect(gameStore.getGameByShortId('ZZZZZZ')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // removeGame
  // ---------------------------------------------------------------------------
  describe('removeGame', () => {
    it('removeGame_givenExistingGame_shouldDeleteIt', () => {
      const game = makeGameStub('game-1');
      gameStore.addGame(game);
      gameStore.removeGame('game-1');
      expect(gameStore.getGame('game-1')).toBeUndefined();
    });

    it('removeGame_givenNonExistingId_shouldNotThrow', () => {
      expect(() => gameStore.removeGame('no-existe')).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // getAll / count
  // ---------------------------------------------------------------------------
  describe('getAll & count', () => {
    it('getAll_givenMultipleGames_shouldReturnAllOfThem', () => {
      gameStore.addGame(makeGameStub('game-a'));
      gameStore.addGame(makeGameStub('game-b'));
      expect(gameStore.getAll()).toHaveLength(2);
    });

    it('count_givenEmptyStore_shouldReturnZero', () => {
      expect(gameStore.count()).toBe(0);
    });

    it('count_givenThreeGames_shouldReturnThree', () => {
      gameStore.addGame(makeGameStub('g1'));
      gameStore.addGame(makeGameStub('g2'));
      gameStore.addGame(makeGameStub('g3'));
      expect(gameStore.count()).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // recordFinishedGame / countFinishedGamesInLastHour
  // ---------------------------------------------------------------------------
  describe('recordFinishedGame & countFinishedGamesInLastHour', () => {
    it('recordFinishedGame_givenGameId_shouldIncrementCount', () => {
      gameStore.recordFinishedGame('game-1');
      expect(gameStore.countFinishedGamesInLastHour()).toBe(1);
    });

    it('countFinishedGamesInLastHour_givenNoFinishedGames_shouldReturnZero', () => {
      expect(gameStore.countFinishedGamesInLastHour()).toBe(0);
    });

    it('countFinishedGamesInLastHour_givenOldRecords_shouldExcludeThem', () => {
      // Simular un registro muy antiguo (más de 1 hora)
      const oldTimestamp = Date.now() - 3_700_000; // hace ~1h 1min
      gameStore.finishedGamesLog.push({ id: 'old-game', finishedAt: oldTimestamp });
      expect(gameStore.countFinishedGamesInLastHour()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // clear
  // ---------------------------------------------------------------------------
  describe('clear', () => {
    it('clear_givenGamesInStore_shouldRemoveAll', () => {
      gameStore.addGame(makeGameStub('g1'));
      gameStore.addGame(makeGameStub('g2'));
      gameStore.clear();
      expect(gameStore.count()).toBe(0);
    });

    it('clear_givenFinishedGames_shouldResetLog', () => {
      gameStore.recordFinishedGame('g1');
      gameStore.clear();
      expect(gameStore.countFinishedGamesInLastHour()).toBe(0);
    });
  });
});
