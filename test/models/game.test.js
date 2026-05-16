/**
 * Tests unitarios para el modelo Game.
 * Cubre: addPlayer, removePlayer, getPlayer, setPhase, addLogEntry, toJSON.
 * La dependencia con config se mockea para aislar el módulo.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock de config ANTES de importar Game (ESM: el mock debe preceder a la importación dinámica)
jest.unstable_mockModule('../../src/config/index.js', () => ({
  config: {
    maxEconomicCredits: 1000,
    initialResearchCredits: 500,
  },
}));

const { Game } = await import('../../src/models/game.js');

// Player stub ligero para no depender del modelo real
function makePlayerStub(characterId, isHost = false) {
  return {
    characterId,
    isHost,
    toJSON: () => ({ characterId }),
  };
}

describe('Game', () => {
  /** @type {Game} */
  let game;

  beforeEach(() => {
    game = new Game({ id: 'game-uuid-001', maxPlayers: 4 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // addPlayer
  // ---------------------------------------------------------------------------
  describe('addPlayer', () => {
    it('addPlayer_givenFirstPlayer_shouldSetIsHostTrue', () => {
      const player = makePlayerStub('char-1', false);
      game.addPlayer(player);
      expect(player.isHost).toBe(true);
    });

    it('addPlayer_givenMultiplePlayers_shouldIndexByCharacterId', () => {
      game.addPlayer(makePlayerStub('char-1'));
      game.addPlayer(makePlayerStub('char-2'));
      expect(game.players['char-1']).toBeDefined();
      expect(game.players['char-2']).toBeDefined();
    });

    it('addPlayer_givenFullGame_shouldThrowError', () => {
      const smallGame = new Game({ id: 'game-full', maxPlayers: 2 });
      smallGame.addPlayer(makePlayerStub('char-1'));
      smallGame.addPlayer(makePlayerStub('char-2'));
      expect(() => smallGame.addPlayer(makePlayerStub('char-3'))).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // removePlayer
  // ---------------------------------------------------------------------------
  describe('removePlayer', () => {
    it('removePlayer_givenExistingPlayer_shouldRemoveIt', () => {
      game.addPlayer(makePlayerStub('char-1'));
      game.removePlayer('char-1');
      expect(game.players['char-1']).toBeUndefined();
    });

    it('removePlayer_givenHostLeaves_shouldTransferHostToNext', () => {
      const host = makePlayerStub('char-1', true);
      const guest = makePlayerStub('char-2', false);
      game.addPlayer(host);
      game.addPlayer(guest);
      game.removePlayer('char-1');
      expect(guest.isHost).toBe(true);
    });

    it('removePlayer_givenNonExistingPlayer_shouldNotThrow', () => {
      expect(() => game.removePlayer('char-inexistente')).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // getPlayer
  // ---------------------------------------------------------------------------
  describe('getPlayer', () => {
    it('getPlayer_givenExistingCharacterId_shouldReturnPlayer', () => {
      const player = makePlayerStub('char-1');
      game.addPlayer(player);
      expect(game.getPlayer('char-1')).toBe(player);
    });

    it('getPlayer_givenUnknownCharacterId_shouldReturnUndefined', () => {
      expect(game.getPlayer('unknown')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // setPhase
  // ---------------------------------------------------------------------------
  describe('setPhase', () => {
    it('setPhase_givenPreparation_shouldSetStartedAt', () => {
      // Stub de jugador para que setPhase no falle al asignar créditos
      const player = { economicCredits: 0, researchCredits: 0 };
      game.players['char-1'] = player;
      game.setPhase('preparation');
      expect(game.phase).toBe('preparation');
      expect(game.startedAt).not.toBeNull();
    });

    it('setPhase_givenPreparation_shouldAssignInitialCreditsToPlayers', () => {
      const player = { economicCredits: 0, researchCredits: 0 };
      game.players['char-1'] = player;
      game.setPhase('preparation');
      expect(player.economicCredits).toBe(1000);
      expect(player.researchCredits).toBe(500);
    });

    it('setPhase_givenFinished_shouldSetEndedAt', () => {
      game.setPhase('finished');
      expect(game.endedAt).not.toBeNull();
    });

    it('setPhase_givenWar_shouldOnlyChangePhase', () => {
      game.setPhase('war');
      expect(game.phase).toBe('war');
      expect(game.startedAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // addLogEntry
  // ---------------------------------------------------------------------------
  describe('addLogEntry', () => {
    it('addLogEntry_givenEntry_shouldAddToBattleLog', () => {
      game.addLogEntry({ performer: 'Viking', action: 'Ataca', type: 'attack' });
      expect(game.battleLog).toHaveLength(1);
    });

    it('addLogEntry_givenEntry_shouldReturnNewEntry', () => {
      const entry = game.addLogEntry({ performer: 'Sistema', action: 'Inicio', type: 'system' });
      expect(entry.performer).toBe('Sistema');
      expect(entry.type).toBe('system');
      expect(entry.id).toBeDefined();
    });

    it('addLogEntry_givenDefaultVisibility_shouldBePublic', () => {
      const entry = game.addLogEntry({ performer: 'Viking', action: 'Entrena', type: 'train' });
      expect(entry.visibility).toBe('public');
    });

    it('addLogEntry_givenMoreThan200Entries_shouldTrimOldestEntry', () => {
      // Rellenar el log hasta el límite
      for (let i = 0; i < 200; i++) {
        game.addLogEntry({ performer: 'P', action: `Acción ${i}`, type: 'system' });
      }
      // Al añadir la 201, se elimina la primera
      game.addLogEntry({ performer: 'P', action: 'La que provoca el trim', type: 'system' });
      expect(game.battleLog).toHaveLength(200);
    });
  });

  // ---------------------------------------------------------------------------
  // toJSON
  // ---------------------------------------------------------------------------
  describe('toJSON', () => {
    it('toJSON_givenGame_shouldSerializePhaseAsUpperCase', () => {
      game.setPhase('war');
      const json = game.toJSON();
      expect(json.phase).toBe('WAR');
    });

    it('toJSON_givenGame_shouldIncludeAllTopLevelFields', () => {
      const json = game.toJSON();
      expect(json.id).toBe('game-uuid-001');
      expect(json.maxPlayers).toBe(4);
      expect(json.eventQueue).toBeDefined();
      expect(json.battleLog).toBeDefined();
    });
  });
});
