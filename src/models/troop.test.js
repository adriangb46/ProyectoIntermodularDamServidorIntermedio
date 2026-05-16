/**
 * Tests unitarios para el modelo Troop.
 * Cubre: constructor, deploy, returnHome, takeDamage, isDead, toJSON.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { Troop } from './troop.js';

describe('Troop', () => {
  /** @type {Troop} */
  let troop;

  beforeEach(() => {
    troop = new Troop({ typeId: 'warrior', clanId: 'berserkers', maxPoints: 100 });
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------
  describe('constructor', () => {
    it('constructor_givenNoCurrentPoints_shouldDefaultToMaxPoints', () => {
      expect(troop.currentPoints).toBe(100);
    });

    it('constructor_givenCurrentPoints_shouldUseProvidedValue', () => {
      const t = new Troop({ typeId: 'warrior', clanId: 'berserkers', maxPoints: 100, currentPoints: 40 });
      expect(t.currentPoints).toBe(40);
    });

    it('constructor_givenNoId_shouldGenerateUUID', () => {
      expect(typeof troop.id).toBe('string');
      expect(troop.id.length).toBeGreaterThan(0);
    });

    it('constructor_givenCustomId_shouldUseProvidedId', () => {
      const t = new Troop({ id: 'custom-id', typeId: 'warrior', clanId: 'berserkers', maxPoints: 100 });
      expect(t.id).toBe('custom-id');
    });

    it('constructor_givenNewTroop_shouldNotBeDeployed', () => {
      expect(troop.deployed).toBe(false);
      expect(troop.travelTargetId).toBeNull();
      expect(troop.arrivalAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // deploy
  // ---------------------------------------------------------------------------
  describe('deploy', () => {
    it('deploy_givenTarget_shouldMarkAsDeployed', () => {
      troop.deploy('char-target', 99999);
      expect(troop.deployed).toBe(true);
    });

    it('deploy_givenTarget_shouldSetTravelTargetId', () => {
      troop.deploy('char-target', 99999);
      expect(troop.travelTargetId).toBe('char-target');
    });

    it('deploy_givenArrival_shouldSetArrivalAt', () => {
      troop.deploy('char-target', 99999);
      expect(troop.arrivalAt).toBe(99999);
    });
  });

  // ---------------------------------------------------------------------------
  // returnHome
  // ---------------------------------------------------------------------------
  describe('returnHome', () => {
    it('returnHome_givenDeployedTroop_shouldResetToCapital', () => {
      troop.deploy('char-target', 99999);
      troop.returnHome();
      expect(troop.deployed).toBe(false);
      expect(troop.travelTargetId).toBeNull();
      expect(troop.arrivalAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // takeDamage
  // ---------------------------------------------------------------------------
  describe('takeDamage', () => {
    it('takeDamage_givenDamageLessThanHealth_shouldReducePoints', () => {
      // Infligir 30 de daño a una tropa con 100 HP
      const overflow = troop.takeDamage(30);
      expect(troop.currentPoints).toBe(70);
      expect(overflow).toBe(0);
    });

    it('takeDamage_givenDamageEqualToHealth_shouldKillTroopWithNoOverflow', () => {
      const overflow = troop.takeDamage(100);
      expect(troop.currentPoints).toBe(0);
      expect(overflow).toBe(0);
    });

    it('takeDamage_givenDamageExceedingHealth_shouldReturnOverflow', () => {
      // 150 de daño sobre 100 HP → 50 de desbordamiento
      const overflow = troop.takeDamage(150);
      expect(troop.currentPoints).toBe(0);
      expect(overflow).toBe(50);
    });

    it('takeDamage_givenZeroDamage_shouldNotChangePoints', () => {
      const overflow = troop.takeDamage(0);
      expect(troop.currentPoints).toBe(100);
      expect(overflow).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // isDead
  // ---------------------------------------------------------------------------
  describe('isDead', () => {
    it('isDead_givenFullHealth_shouldReturnFalse', () => {
      expect(troop.isDead()).toBe(false);
    });

    it('isDead_givenZeroHealth_shouldReturnTrue', () => {
      troop.takeDamage(100);
      expect(troop.isDead()).toBe(true);
    });

    it('isDead_givenPartialDamage_shouldReturnFalse', () => {
      troop.takeDamage(50);
      expect(troop.isDead()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // toJSON
  // ---------------------------------------------------------------------------
  describe('toJSON', () => {
    it('toJSON_givenTroop_shouldSerializeAllPublicFields', () => {
      const json = troop.toJSON();
      expect(json).toMatchObject({
        typeId: 'warrior',
        clanId: 'berserkers',
        maxPoints: 100,
        currentPoints: 100,
        deployed: false,
        travelTargetId: null,
        arrivalAt: null,
      });
    });

    it('toJSON_givenDeployedTroop_shouldSerializeDeployedState', () => {
      troop.deploy('char-enemy', 12345);
      const json = troop.toJSON();
      expect(json.deployed).toBe(true);
      expect(json.travelTargetId).toBe('char-enemy');
      expect(json.arrivalAt).toBe(12345);
    });
  });
});
