/**
 * Tests unitarios para victory-checker.js.
 * Cubre: checkVictory — fases inválidas, partida con >2 jugadores,
 *        transición a END (2 jugadores), victoria con 1 jugador, empate con 0.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// --- Mocks de dependencias externas ---
jest.unstable_mockModule('../../../src/db/db-connector.js', () => ({
  dbConnector: {
    endGame: jest.fn().mockResolvedValue({}),
    dumpState: jest.fn().mockResolvedValue({}),
    publishAnalyticsSnapshot: jest.fn().mockResolvedValue({}),
  },
}));

jest.unstable_mockModule('../../../src/game/state/sync-manager.js', () => ({
  syncManager: {
    mapGameToAnalyticsSnapshot: jest.fn().mockReturnValue({}),
  },
}));

jest.unstable_mockModule('../../../src/game/state/game-store.js', () => ({
  gameStore: {
    recordFinishedGame: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// Importaciones dinámicas DESPUÉS de los mocks
const { checkVictory } = await import('../../../src/game/engine/victory-checker.js');
const { dbConnector } = await import('../../../src/db/db-connector.js');
const { gameStore } = await import('../../../src/game/state/game-store.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayer({ characterId, eliminated = false, capitalHealth = 3000 } = {}) {
  return { characterId, eliminated, capitalHealth };
}

function makeGame({ phase = 'war', players = {} } = {}) {
  return {
    id: 'game-uuid-001',
    phase,
    players,
    setPhase(newPhase) { this.phase = newPhase; },
    toJSON() { return { id: this.id, phase: this.phase }; },
  };
}

/** Mock de instancia de Socket.IO */
function makeIo() {
  const emitFn = jest.fn();
  const toFn = jest.fn(() => ({ emit: emitFn }));
  return { to: toFn, _emit: emitFn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('victory-checker — checkVictory', () => {
  /** @type {ReturnType<makeIo>} */
  let io;

  beforeEach(() => {
    io = makeIo();
    jest.clearAllMocks();
  });

  afterEach(() => jest.restoreAllMocks());

  // ---------------------------------------------------------------------------
  // Fases inválidas
  // ---------------------------------------------------------------------------
  describe('fases inválidas', () => {
    it('checkVictory_givenWaitingPhase_shouldReturnFalse', () => {
      const game = makeGame({ phase: 'waiting', players: { c1: makePlayer({ characterId: 'c1' }) } });
      expect(checkVictory(game, io)).toBe(false);
    });

    it('checkVictory_givenFinishedPhase_shouldReturnFalse', () => {
      const game = makeGame({ phase: 'finished', players: { c1: makePlayer({ characterId: 'c1' }) } });
      expect(checkVictory(game, io)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Más de 2 jugadores activos → partida continúa
  // ---------------------------------------------------------------------------
  describe('más de 2 jugadores activos', () => {
    it('checkVictory_givenThreeActivePlayers_shouldReturnFalse', () => {
      const game = makeGame({
        phase: 'war',
        players: {
          c1: makePlayer({ characterId: 'c1' }),
          c2: makePlayer({ characterId: 'c2' }),
          c3: makePlayer({ characterId: 'c3' }),
        },
      });
      expect(checkVictory(game, io)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2 jugadores activos en fase war → transición a END
  // ---------------------------------------------------------------------------
  describe('2 jugadores activos en guerra', () => {
    it('checkVictory_givenTwoPlayersInWar_shouldTransitionToEnd', () => {
      const game = makeGame({
        phase: 'war',
        players: {
          c1: makePlayer({ characterId: 'c1' }),
          c2: makePlayer({ characterId: 'c2' }),
        },
      });

      const result = checkVictory(game, io);

      expect(result).toBe(true);
      expect(game.phase).toBe('end');
    });

    it('checkVictory_givenTwoPlayersInWar_shouldEmitPhaseChanged', () => {
      const game = makeGame({
        phase: 'war',
        players: {
          c1: makePlayer({ characterId: 'c1' }),
          c2: makePlayer({ characterId: 'c2' }),
        },
      });

      checkVictory(game, io);

      expect(io.to).toHaveBeenCalledWith('game_game-uuid-001');
      expect(io._emit).toHaveBeenCalledWith('game:phase-changed', expect.objectContaining({ newPhase: 'end' }));
    });

    it('checkVictory_givenTwoPlayersAlreadyInEnd_shouldReturnFalse', () => {
      // Si ya estamos en 'end', no hay que transicionar de nuevo
      const game = makeGame({
        phase: 'end',
        players: {
          c1: makePlayer({ characterId: 'c1' }),
          c2: makePlayer({ characterId: 'c2' }),
        },
      });

      const result = checkVictory(game, io);

      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 1 jugador activo → victoria
  // ---------------------------------------------------------------------------
  describe('1 jugador activo — victoria', () => {
    it('checkVictory_givenOneActivePlayer_shouldReturnTrue', () => {
      const game = makeGame({
        phase: 'war',
        players: {
          c1: makePlayer({ characterId: 'c1' }),
          c2: makePlayer({ characterId: 'c2', eliminated: true }),
        },
      });

      expect(checkVictory(game, io)).toBe(true);
    });

    it('checkVictory_givenOneActivePlayer_shouldTransitionToFinished', () => {
      const game = makeGame({
        phase: 'war',
        players: {
          c1: makePlayer({ characterId: 'c1' }),
          c2: makePlayer({ characterId: 'c2', capitalHealth: 0 }),
        },
      });

      checkVictory(game, io);

      expect(game.phase).toBe('finished');
    });

    it('checkVictory_givenOneActivePlayer_shouldEmitGameEnded', () => {
      const game = makeGame({
        phase: 'war',
        players: {
          c1: makePlayer({ characterId: 'c1' }),
          c2: makePlayer({ characterId: 'c2', eliminated: true }),
        },
      });

      checkVictory(game, io);

      expect(io._emit).toHaveBeenCalledWith('game:ended', expect.objectContaining({
        winnerCharacterId: 'c1',
        phase: 'finished',
      }));
    });

    it('checkVictory_givenOneActivePlayer_shouldRecordFinishedGame', () => {
      const game = makeGame({
        phase: 'war',
        players: {
          c1: makePlayer({ characterId: 'c1' }),
          c2: makePlayer({ characterId: 'c2', eliminated: true }),
        },
      });

      checkVictory(game, io);

      expect(gameStore.recordFinishedGame).toHaveBeenCalledWith('game-uuid-001');
    });

    it('checkVictory_givenOneActivePlayer_shouldNotifyDbServer', async () => {
      const game = makeGame({
        phase: 'war',
        players: {
          c1: makePlayer({ characterId: 'c1' }),
          c2: makePlayer({ characterId: 'c2', eliminated: true }),
        },
      });

      checkVictory(game, io);
      // Dar tiempo al Promise de dbConnector.endGame
      await Promise.resolve();

      expect(dbConnector.endGame).toHaveBeenCalledWith('game-uuid-001', { winnerCharacterId: 'c1' });
    });
  });

  // ---------------------------------------------------------------------------
  // 0 jugadores activos → empate
  // ---------------------------------------------------------------------------
  describe('0 jugadores activos — empate', () => {
    it('checkVictory_givenZeroActivePlayers_shouldReturnTrue', () => {
      const game = makeGame({
        phase: 'war',
        players: {
          c1: makePlayer({ characterId: 'c1', eliminated: true }),
          c2: makePlayer({ characterId: 'c2', eliminated: true }),
        },
      });

      expect(checkVictory(game, io)).toBe(true);
    });

    it('checkVictory_givenZeroActivePlayers_shouldEmitNullWinner', () => {
      const game = makeGame({
        phase: 'war',
        players: {
          c1: makePlayer({ characterId: 'c1', capitalHealth: 0 }),
          c2: makePlayer({ characterId: 'c2', capitalHealth: 0 }),
        },
      });

      checkVictory(game, io);

      expect(io._emit).toHaveBeenCalledWith('game:ended', expect.objectContaining({
        winnerCharacterId: null,
      }));
    });
  });

  // ---------------------------------------------------------------------------
  // Idempotencia — no se reprocesa si ya está finished
  // ---------------------------------------------------------------------------
  describe('idempotencia', () => {
    it('checkVictory_givenAlreadyFinished_shouldNotEmitAgain', () => {
      const game = makeGame({
        phase: 'finished',
        players: {
          c1: makePlayer({ characterId: 'c1' }),
        },
      });

      checkVictory(game, io);

      // La partida en estado finished no entra en la lógica
      expect(io._emit).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Fase preparation — victoria inmediata si queda 1 jugador
  // ---------------------------------------------------------------------------
  describe('fase preparation', () => {
    it('checkVictory_givenOnePlayerInPreparation_shouldTriggerVictory', () => {
      const game = makeGame({
        phase: 'preparation',
        players: {
          c1: makePlayer({ characterId: 'c1' }),
          c2: makePlayer({ characterId: 'c2', eliminated: true }),
        },
      });

      const result = checkVictory(game, io);

      expect(result).toBe(true);
      expect(game.phase).toBe('finished');
    });
  });
});
