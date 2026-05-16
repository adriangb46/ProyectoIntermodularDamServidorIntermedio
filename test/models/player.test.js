/**
 * Tests unitarios para el modelo Player.
 * Cubre: constructor, addTroop, cleanupDeadTroops,
 *        getDefendingTroops, getTotalDefensePower, toJSON.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { Player } from '../../src/models/player.js';
import { Troop } from '../../src/models/troop.js';

/** Crea un jugador de prueba con valores por defecto */
function makePlayer(overrides = {}) {
  return new Player({
    characterId: 'char-1',
    userId: 'user-1',
    username: 'TestViking',
    clanId: 'berserkers',
    capitalHealth: 3000,
    ...overrides,
  });
}

/** Crea una tropa de prueba */
function makeTroop({ maxPoints = 100, currentPoints = undefined, deployed = false } = {}) {
  const t = new Troop({ typeId: 'warrior', clanId: 'berserkers', maxPoints, currentPoints });
  if (deployed) t.deploy('enemy-char', Date.now() + 10000);
  return t;
}

describe('Player', () => {
  /** @type {Player} */
  let player;

  beforeEach(() => {
    player = makePlayer();
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------
  describe('constructor', () => {
    it('constructor_givenData_shouldInitializeCreditsToZero', () => {
      // Los créditos se asignan en setPhase, no en el constructor
      expect(player.economicCredits).toBe(0);
      expect(player.researchCredits).toBe(0);
    });

    it('constructor_givenCapitalHealth_shouldSetCapitalHealth', () => {
      expect(player.capitalHealth).toBe(3000);
    });

    it('constructor_givenNoIsHost_shouldDefaultToFalse', () => {
      expect(player.isHost).toBe(false);
    });

    it('constructor_givenIsHostTrue_shouldSetFlag', () => {
      const host = makePlayer({ isHost: true });
      expect(host.isHost).toBe(true);
    });

    it('constructor_givenNewPlayer_shouldNotBeEliminated', () => {
      expect(player.eliminated).toBe(false);
    });

    it('constructor_givenNewPlayer_shouldHaveEmptyTroopsAndQueue', () => {
      expect(player.troops).toHaveLength(0);
      expect(player.trainingQueue).toHaveLength(0);
      expect(player.unlockedResearches).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // addTroop
  // ---------------------------------------------------------------------------
  describe('addTroop', () => {
    it('addTroop_givenTroop_shouldAddToCollection', () => {
      const troop = makeTroop();
      player.addTroop(troop);
      expect(player.troops).toHaveLength(1);
      expect(player.troops[0]).toBe(troop);
    });

    it('addTroop_givenMultipleTroops_shouldAccumulateThem', () => {
      player.addTroop(makeTroop());
      player.addTroop(makeTroop());
      expect(player.troops).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // cleanupDeadTroops
  // ---------------------------------------------------------------------------
  describe('cleanupDeadTroops', () => {
    it('cleanupDeadTroops_givenDeadTroop_shouldRemoveIt', () => {
      const alive = makeTroop({ maxPoints: 100 });
      const dead = makeTroop({ maxPoints: 100, currentPoints: 0 });
      player.addTroop(alive);
      player.addTroop(dead);
      player.cleanupDeadTroops();
      expect(player.troops).toHaveLength(1);
      expect(player.troops[0]).toBe(alive);
    });

    it('cleanupDeadTroops_givenOnlyLivingTroops_shouldLeaveArrayIntact', () => {
      player.addTroop(makeTroop({ maxPoints: 100 }));
      player.addTroop(makeTroop({ maxPoints: 50 }));
      player.cleanupDeadTroops();
      expect(player.troops).toHaveLength(2);
    });

    it('cleanupDeadTroops_givenEmptyArray_shouldNotThrow', () => {
      expect(() => player.cleanupDeadTroops()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // getDefendingTroops
  // ---------------------------------------------------------------------------
  describe('getDefendingTroops', () => {
    it('getDefendingTroops_givenDeployedTroop_shouldExcludeIt', () => {
      const atHome = makeTroop();
      const deployed = makeTroop({ deployed: true });
      player.addTroop(atHome);
      player.addTroop(deployed);
      expect(player.getDefendingTroops()).toHaveLength(1);
      expect(player.getDefendingTroops()[0]).toBe(atHome);
    });

    it('getDefendingTroops_givenDeadTroop_shouldExcludeIt', () => {
      const dead = makeTroop({ currentPoints: 0 });
      player.addTroop(dead);
      expect(player.getDefendingTroops()).toHaveLength(0);
    });

    it('getDefendingTroops_givenNoTroops_shouldReturnEmptyArray', () => {
      expect(player.getDefendingTroops()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getTotalDefensePower
  // ---------------------------------------------------------------------------
  describe('getTotalDefensePower', () => {
    it('getTotalDefensePower_givenTwoTroops_shouldSumCurrentPoints', () => {
      player.addTroop(makeTroop({ maxPoints: 100 }));
      player.addTroop(makeTroop({ maxPoints: 200 }));
      expect(player.getTotalDefensePower()).toBe(300);
    });

    it('getTotalDefensePower_givenNoTroops_shouldReturnZero', () => {
      expect(player.getTotalDefensePower()).toBe(0);
    });

    it('getTotalDefensePower_givenDeployedTroop_shouldExcludeIt', () => {
      // Las tropas desplegadas no defienden la capital
      player.addTroop(makeTroop({ maxPoints: 100 }));
      player.addTroop(makeTroop({ maxPoints: 50, deployed: true }));
      expect(player.getTotalDefensePower()).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // toJSON
  // ---------------------------------------------------------------------------
  describe('toJSON', () => {
    it('toJSON_givenPlayer_shouldIncludeIdentityFields', () => {
      const json = player.toJSON();
      expect(json.characterId).toBe('char-1');
      expect(json.userId).toBe('user-1');
      expect(json.username).toBe('TestViking');
      expect(json.clanId).toBe('berserkers');
    });

    it('toJSON_givenTroops_shouldSerializeTroopsArray', () => {
      player.addTroop(makeTroop({ maxPoints: 100 }));
      const json = player.toJSON();
      expect(Array.isArray(json.troops)).toBe(true);
      expect(json.troops[0].maxPoints).toBe(100);
    });

    it('toJSON_givenPlayer_shouldIncludeStatsObject', () => {
      const json = player.toJSON();
      expect(json.stats).toBeDefined();
      expect(json.stats.totalAttacksLaunched).toBe(0);
    });
  });
});
