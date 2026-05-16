/**
 * Tests unitarios para combat-resolver.js.
 * Cubre: resolveBattle — multiplicador de tipo, daño a defensores,
 *        daño de retorno, overflow a capital, créditos de investigación,
 *        eliminación del defensor.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock de config ANTES de importar el módulo bajo prueba
jest.unstable_mockModule('../../config/index.js', () => ({
  config: {
    typeAdvantageMultiplier: 1.5,
    capitalDefenseBonus: 1.1,
    researchCreditsRate: 1,
  },
}));

const { resolveBattle } = await import('./combat-resolver.js');

// ---------------------------------------------------------------------------
// Helpers de prueba
// ---------------------------------------------------------------------------

/**
 * Crea una tropa stub compatible con la interfaz usada por combat-resolver.
 * Implementa takeDamage e isDead para que el módulo pueda operar sobre ellas.
 */
function makeTroop(currentPoints = 100) {
  const troop = {
    currentPoints,
    deployed: false,
    takeDamage(points) {
      const dealt = Math.min(this.currentPoints, points);
      this.currentPoints -= dealt;
      return points - dealt;
    },
    isDead() { return this.currentPoints <= 0; },
    toJSON() { return { currentPoints: this.currentPoints }; },
  };
  return troop;
}

/**
 * Crea un stub de Player con la interfaz mínima que usa combat-resolver:
 *  - getDefendingTroops()
 *  - cleanupDeadTroops()
 *  - capitalHealth
 *  - eliminated
 *  - clanId
 */
function makePlayer({ clanId = 'berserkers', capitalHealth = 3000, troops = [] } = {}) {
  return {
    clanId,
    capitalHealth,
    eliminated: false,
    troops,
    getDefendingTroops() {
      return this.troops.filter(t => !t.deployed && t.currentPoints > 0);
    },
    cleanupDeadTroops() {
      this.troops = this.troops.filter(t => t.currentPoints > 0);
    },
  };
}

/** gameData de prueba con dos clanes y ventaja hexagonal */
const mockGameData = {
  berserkers: { archetype: 'FURY',  advantages: ['FROST'] },
  valkyrias:  { archetype: 'FROST', advantages: ['SHADOW'] },
  shadow:     { archetype: 'SHADOW', advantages: [] },
};

describe('combat-resolver — resolveBattle', () => {
  afterEach(() => jest.restoreAllMocks());

  // ---------------------------------------------------------------------------
  // Multiplicador de tipo
  // ---------------------------------------------------------------------------
  describe('type advantage multiplier', () => {
    it('resolveBattle_givenAttackerHasAdvantage_shouldApply1_5xMultiplier', () => {
      // berserkers (FURY) tiene ventaja sobre FROST (valkyrias)
      const attacker = makePlayer({ clanId: 'berserkers' });
      const defender = makePlayer({ clanId: 'valkyrias', capitalHealth: 3000 });
      const attackingTroops = [makeTroop(100)];

      const result = resolveBattle(attacker, defender, attackingTroops, mockGameData);

      expect(result.typeMultiplier).toBe(1.5);
      // finalAttackPower = round(100 * 1.5) = 150
      expect(result.finalAttackPower).toBe(150);
    });

    it('resolveBattle_givenNoAdvantage_shouldApply1_0xMultiplier', () => {
      // berserkers vs shadow: no hay ventaja
      const attacker = makePlayer({ clanId: 'berserkers' });
      const defender = makePlayer({ clanId: 'shadow', capitalHealth: 3000 });
      const attackingTroops = [makeTroop(100)];

      const result = resolveBattle(attacker, defender, attackingTroops, mockGameData);

      expect(result.typeMultiplier).toBe(1.0);
      expect(result.finalAttackPower).toBe(100);
    });

    it('resolveBattle_givenUnknownClan_shouldDefaultToNoMultiplier', () => {
      const attacker = makePlayer({ clanId: 'unknown_clan' });
      const defender = makePlayer({ clanId: 'valkyrias', capitalHealth: 3000 });
      const attackingTroops = [makeTroop(100)];

      const result = resolveBattle(attacker, defender, attackingTroops, mockGameData);

      expect(result.typeMultiplier).toBe(1.0);
    });
  });

  // ---------------------------------------------------------------------------
  // Daño a tropas defensoras
  // ---------------------------------------------------------------------------
  describe('damage to defending troops', () => {
    it('resolveBattle_givenEnoughDamage_shouldDestroyDefendingTroops', () => {
      const defender = makePlayer({
        clanId: 'shadow',
        capitalHealth: 3000,
        troops: [makeTroop(50), makeTroop(50)],
      });
      const attacker = makePlayer({ clanId: 'shadow' });
      // 150 de ataque destruye ambas tropas (50+50=100)
      const attackingTroops = [makeTroop(150)];

      const result = resolveBattle(attacker, defender, attackingTroops, mockGameData);

      expect(result.defenderTroopsDestroyed).toHaveLength(2);
    });

    it('resolveBattle_givenInsufficientDamage_shouldNotDestroyAllTroops', () => {
      const defender = makePlayer({
        clanId: 'shadow',
        capitalHealth: 3000,
        troops: [makeTroop(200)],
      });
      const attacker = makePlayer({ clanId: 'shadow' });
      const attackingTroops = [makeTroop(50)];

      const result = resolveBattle(attacker, defender, attackingTroops, mockGameData);

      expect(result.defenderTroopsDestroyed).toHaveLength(0);
      expect(result.capitalDamage).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Overflow a la capital
  // ---------------------------------------------------------------------------
  describe('overflow damage to capital', () => {
    it('resolveBattle_givenOverflowDamage_shouldReduceCapitalHealth', () => {
      // Sin tropas defensoras, todo el daño va a la capital
      const defender = makePlayer({ clanId: 'shadow', capitalHealth: 3000, troops: [] });
      const attacker = makePlayer({ clanId: 'shadow' });
      const attackingTroops = [makeTroop(200)];

      const result = resolveBattle(attacker, defender, attackingTroops, mockGameData);

      expect(result.capitalDamage).toBeGreaterThan(0);
      expect(defender.capitalHealth).toBeLessThan(3000);
    });

    it('resolveBattle_givenDamageExceedsCapital_shouldNotReduceBelowZero', () => {
      const defender = makePlayer({ clanId: 'shadow', capitalHealth: 100, troops: [] });
      const attacker = makePlayer({ clanId: 'shadow' });
      const attackingTroops = [makeTroop(9999)];

      resolveBattle(attacker, defender, attackingTroops, mockGameData);

      expect(defender.capitalHealth).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Daño de retorno al atacante
  // ---------------------------------------------------------------------------
  describe('return damage to attacker', () => {
    it('resolveBattle_givenDefendingTroops_shouldDamageAttackingTroops', () => {
      const defender = makePlayer({
        clanId: 'shadow',
        capitalHealth: 3000,
        troops: [makeTroop(80)],
      });
      const attacker = makePlayer({ clanId: 'shadow' });
      const attackingTroops = [makeTroop(50)]; // La tropa atacante debería morir

      const result = resolveBattle(attacker, defender, attackingTroops, mockGameData);

      // El defensor inflige round(80 * 1.1) = 88 puntos, más que los 50 de la tropa atacante
      expect(result.attackerTroopsLost).toHaveLength(1);
    });

    it('resolveBattle_givenNoDefendingTroops_shouldHaveNoReturnDamage', () => {
      const defender = makePlayer({ clanId: 'shadow', capitalHealth: 3000, troops: [] });
      const attacker = makePlayer({ clanId: 'shadow' });
      const attackingTroops = [makeTroop(100)];

      const result = resolveBattle(attacker, defender, attackingTroops, mockGameData);

      expect(result.attackerTroopsLost).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Créditos de investigación
  // ---------------------------------------------------------------------------
  describe('research credits earned', () => {
    it('resolveBattle_givenDamageDealt_shouldEarnResearchCredits', () => {
      const defender = makePlayer({ clanId: 'shadow', capitalHealth: 3000, troops: [] });
      const attacker = makePlayer({ clanId: 'shadow' });
      const attackingTroops = [makeTroop(100)];

      const result = resolveBattle(attacker, defender, attackingTroops, mockGameData);

      // researchCreditsRate = 1, daño infligido = 100 → floor(100 * 1) = 100
      expect(result.researchCreditsEarned).toBe(100);
    });

    it('resolveBattle_givenZeroDamage_shouldEarnZeroCredits', () => {
      // 0 tropas atacantes → 0 daño → 0 créditos
      const defender = makePlayer({ clanId: 'shadow', capitalHealth: 3000 });
      const attacker = makePlayer({ clanId: 'shadow' });

      const result = resolveBattle(attacker, defender, [], mockGameData);

      expect(result.researchCreditsEarned).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Eliminación del defensor
  // ---------------------------------------------------------------------------
  describe('defender elimination', () => {
    it('resolveBattle_givenCapitalHealthReachesZero_shouldEliminateDefender', () => {
      const defender = makePlayer({ clanId: 'shadow', capitalHealth: 50, troops: [] });
      const attacker = makePlayer({ clanId: 'shadow' });
      const attackingTroops = [makeTroop(9999)];

      const result = resolveBattle(attacker, defender, attackingTroops, mockGameData);

      expect(result.defenderEliminated).toBe(true);
      expect(defender.eliminated).toBe(true);
    });

    it('resolveBattle_givenDefenderSurvives_shouldNotBeEliminated', () => {
      const defender = makePlayer({
        clanId: 'shadow',
        capitalHealth: 3000,
        troops: [makeTroop(500)],
      });
      const attacker = makePlayer({ clanId: 'shadow' });
      const attackingTroops = [makeTroop(10)];

      const result = resolveBattle(attacker, defender, attackingTroops, mockGameData);

      expect(result.defenderEliminated).toBe(false);
      expect(defender.eliminated).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Supervivientes del atacante
  // ---------------------------------------------------------------------------
  describe('attacker survivors', () => {
    it('resolveBattle_givenAttackerSurvives_shouldBeInSurvivorsList', () => {
      // El atacante tiene 200 HP, el defensor 0 tropas → no hay daño de retorno
      const defender = makePlayer({ clanId: 'shadow', capitalHealth: 3000, troops: [] });
      const attacker = makePlayer({ clanId: 'shadow' });
      const attackingTroops = [makeTroop(200)];

      const result = resolveBattle(attacker, defender, attackingTroops, mockGameData);

      expect(result.attackerSurvivors).toHaveLength(1);
    });

    it('resolveBattle_givenAllAttackersTroopsDie_shouldHaveNoSurvivors', () => {
      // El defensor tiene muchas tropas → mata a todos los atacantes
      const defender = makePlayer({
        clanId: 'shadow',
        capitalHealth: 3000,
        troops: [makeTroop(9999)],
      });
      const attacker = makePlayer({ clanId: 'shadow' });
      const attackingTroops = [makeTroop(10)];

      const result = resolveBattle(attacker, defender, attackingTroops, mockGameData);

      expect(result.attackerSurvivors).toHaveLength(0);
    });
  });
});
