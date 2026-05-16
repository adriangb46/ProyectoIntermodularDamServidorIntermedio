/**
 * Tests unitarios para el módulo de Niebla de Guerra (Fog of War).
 * Cubre: buildGameView — vista propia y vista rival con censura de datos tácticos.
 * Es un módulo PURO: no tiene dependencias externas, se testea directamente.
 */
import { describe, it, expect } from '@jest/globals';
import { buildGameView } from '../../../src/game/engine/fog-of-war.js';

// ---------------------------------------------------------------------------
// Factories de objetos de prueba
// ---------------------------------------------------------------------------

function makeTroop({ deployed = false, currentPoints = 100, typeId = 'warrior' } = {}) {
  return { typeId, deployed, currentPoints, toJSON: () => ({ typeId, deployed, currentPoints }) };
}

function makePlayer({
  characterId = 'char-1',
  username = 'Viking',
  clanId = 'berserkers',
  isHost = false,
  capitalHealth = 3000,
  eliminated = false,
  troops = [],
  economicCredits = 500,
  researchCredits = 200,
  researchInProgress = null,
  trainingQueue = [],
  unlockedResearches = [],
} = {}) {
  return {
    characterId, username, clanId, isHost, capitalHealth, eliminated,
    troops, economicCredits, researchCredits, researchInProgress,
    trainingQueue, unlockedResearches,
  };
}

function makeGame(players, battleLog = []) {
  return {
    id: 'game-001',
    phase: 'war',
    startedAt: 1000000,
    maxPlayers: 4,
    players,
    battleLog,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Fog of War — buildGameView', () => {

  describe('cabecera pública', () => {
    it('buildGameView_givenGame_shouldIncludePublicHeader', () => {
      const players = { 'char-1': makePlayer({ characterId: 'char-1' }) };
      const view = buildGameView(makeGame(players), 'char-1');
      expect(view.id).toBe('game-001');
      expect(view.phase).toBe('war');
      expect(view.maxPlayers).toBe(4);
    });
  });

  // ---------------------------------------------------------------------------
  // Vista propia (selfView)
  // ---------------------------------------------------------------------------
  describe('vista propia (_buildSelfView)', () => {
    it('buildGameView_givenViewer_shouldIncludeOwnEconomicCredits', () => {
      const players = { 'char-1': makePlayer({ characterId: 'char-1', economicCredits: 750 }) };
      const view = buildGameView(makeGame(players), 'char-1');
      expect(view.players['char-1'].economicCredits).toBe(750);
    });

    it('buildGameView_givenViewer_shouldIncludeOwnResearchCredits', () => {
      const players = { 'char-1': makePlayer({ characterId: 'char-1', researchCredits: 300 }) };
      const view = buildGameView(makeGame(players), 'char-1');
      expect(view.players['char-1'].researchCredits).toBe(300);
    });

    it('buildGameView_givenViewer_shouldIncludeDeployedTroops', () => {
      // El propio jugador ve TODAS sus tropas, incluyendo las desplegadas
      const troops = [makeTroop({ deployed: true }), makeTroop({ deployed: false })];
      const players = { 'char-1': makePlayer({ characterId: 'char-1', troops }) };
      const view = buildGameView(makeGame(players), 'char-1');
      expect(view.players['char-1'].troops).toHaveLength(2);
    });

    it('buildGameView_givenViewer_shouldNotExposeConnectedSocketId', () => {
      // connectedSocketId nunca se envía (es dato interno de infraestructura)
      const players = { 'char-1': makePlayer({ characterId: 'char-1' }) };
      const view = buildGameView(makeGame(players), 'char-1');
      expect(view.players['char-1'].connectedSocketId).toBeUndefined();
    });

    it('buildGameView_givenViewer_shouldNotExposeUserId', () => {
      const players = { 'char-1': makePlayer({ characterId: 'char-1' }) };
      const view = buildGameView(makeGame(players), 'char-1');
      expect(view.players['char-1'].userId).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Vista rival (rivalView) — Fog of War
  // ---------------------------------------------------------------------------
  describe('vista rival (_buildRivalView)', () => {
    function buildRivalView(rivalTroops = []) {
      const viewer = makePlayer({ characterId: 'char-1' });
      const rival = makePlayer({ characterId: 'char-2', troops: rivalTroops, economicCredits: 999 });
      const players = { 'char-1': viewer, 'char-2': rival };
      const view = buildGameView(makeGame(players), 'char-1');
      return view.players['char-2'];
    }

    it('buildGameView_givenRival_shouldNotExposeEconomicCredits', () => {
      const rivalView = buildRivalView();
      expect(rivalView.economicCredits).toBeUndefined();
    });

    it('buildGameView_givenRival_shouldNotExposeResearchCredits', () => {
      const rivalView = buildRivalView();
      expect(rivalView.researchCredits).toBeUndefined();
    });

    it('buildGameView_givenRival_shouldNotExposeTrainingQueue', () => {
      const rivalView = buildRivalView();
      expect(rivalView.trainingQueue).toBeUndefined();
    });

    it('buildGameView_givenRival_shouldNotExposeDeployedTroops', () => {
      // Las tropas desplegadas del rival son invisibles
      const deployed = makeTroop({ deployed: true });
      const atHome = makeTroop({ deployed: false });
      const rivalView = buildRivalView([deployed, atHome]);
      // Solo se muestra el sumario de tropas en capital
      expect(rivalView.troops).toBeUndefined();
      expect(rivalView.troopSummary.count).toBe(1);
    });

    it('buildGameView_givenRival_shouldExposeCapitalHealth', () => {
      const viewer = makePlayer({ characterId: 'char-1' });
      const rival = makePlayer({ characterId: 'char-2', capitalHealth: 1500 });
      const players = { 'char-1': viewer, 'char-2': rival };
      const view = buildGameView(makeGame(players), 'char-1');
      expect(view.players['char-2'].capitalHealth).toBe(1500);
    });

    it('buildGameView_givenRivalWithTroopsInCapital_shouldExposeTroopSummaryTypes', () => {
      const t1 = makeTroop({ deployed: false, typeId: 'warrior' });
      const t2 = makeTroop({ deployed: false, typeId: 'shield_maiden' });
      const rivalView = buildRivalView([t1, t2]);
      expect(rivalView.troopSummary.count).toBe(2);
      expect(rivalView.troopSummary.types).toContain('warrior');
      expect(rivalView.troopSummary.types).toContain('shield_maiden');
    });

    it('buildGameView_givenRivalWithDeadTroops_shouldExcludeFromSummary', () => {
      // Tropas con 0 HP no se muestran en el sumario
      const dead = makeTroop({ deployed: false, currentPoints: 0 });
      const rivalView = buildRivalView([dead]);
      expect(rivalView.troopSummary.count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Filtrado del battleLog por Fog of War
  // ---------------------------------------------------------------------------
  describe('battleLog filtering', () => {
    it('buildGameView_givenPublicLogEntry_shouldBeVisibleToEveryone', () => {
      const players = { 'char-1': makePlayer({ characterId: 'char-1' }) };
      const battleLog = [{ visibility: 'public', action: 'Ataque público' }];
      const view = buildGameView(makeGame(players, battleLog), 'char-1');
      expect(view.battleLog).toHaveLength(1);
    });

    it('buildGameView_givenPrivateLogEntryForViewer_shouldBeVisible', () => {
      const players = { 'char-1': makePlayer({ characterId: 'char-1' }) };
      const battleLog = [{ visibility: 'char-1', action: 'Solo para char-1' }];
      const view = buildGameView(makeGame(players, battleLog), 'char-1');
      expect(view.battleLog).toHaveLength(1);
    });

    it('buildGameView_givenPrivateLogEntryForOther_shouldBeHidden', () => {
      const players = { 'char-1': makePlayer({ characterId: 'char-1' }) };
      const battleLog = [{ visibility: 'char-2', action: 'Solo para char-2' }];
      const view = buildGameView(makeGame(players, battleLog), 'char-1');
      expect(view.battleLog).toHaveLength(0);
    });
  });
});
