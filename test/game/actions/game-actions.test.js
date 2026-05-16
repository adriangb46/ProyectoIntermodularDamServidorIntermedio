/**
 * Tests unitarios para game-actions.js.
 * Cubre: startGame, trainTroop, launchAttack, abandonGame, startResearch.
 * Los datos de clanes (gameData) y config se mockean para aislar la lógica de negocio.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mocks de dependencias (deben preceder a las importaciones dinámicas)
// ---------------------------------------------------------------------------
const mockConfig = {
  troopTravelTimeMs: 10_000,
  preparationDurationMs: 300_000,
};

jest.unstable_mockModule('../../../src/config/index.js', () => ({ config: mockConfig }));

const mockClan = {
  initialTroops: [
    { id: 'warrior', name: 'Guerrero', cost: 100, power: 50, trainingTimeSeconds: 5 },
  ],
  technologies: [
    {
      id: 'tech_berserker_1',
      name: 'Furia Ancestral',
      researchCost: 200,
      durationSeconds: 10,
      requirements: [],
      unlocks: { buffs: [], troops: [] },
    },
    {
      id: 'tech_berserker_2',
      name: 'Berserker Avanzado',
      researchCost: 400,
      durationSeconds: 20,
      requirements: ['tech_berserker_1'],
      unlocks: {
        buffs: [],
        troops: [{ id: 'berserker', name: 'Berserker', cost: 250, power: 120, trainingTimeSeconds: 15 }],
      },
    },
  ],
};

jest.unstable_mockModule('../../../src/config/game-data-loader.js', () => ({
  gameData: { berserkers: mockClan },
}));

const {
  startGame,
  trainTroop,
  launchAttack,
  abandonGame,
  startResearch,
} = await import('../../../src/game/actions/game-actions.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTroop(id = 'troop-1', { deployed = false, currentPoints = 100 } = {}) {
  return { id, deployed, currentPoints, deploy: jest.fn(), returnHome: jest.fn() };
}

function makePlayer({
  characterId = 'char-1',
  clanId = 'berserkers',
  eliminated = false,
  capitalHealth = 3000,
  economicCredits = 1000,
  researchCredits = 500,
  isHost = false,
  troops = [],
  trainingQueue = [],
  unlockedResearches = [],
  researchInProgress = null,
  username = 'Viking',
} = {}) {
  return {
    characterId, clanId, eliminated, capitalHealth,
    economicCredits, researchCredits, isHost,
    troops, trainingQueue, unlockedResearches,
    researchInProgress, username,
    stats: { totalTroopsDeployed: 0 },
  };
}

function makeGame({ phase = 'waiting', players = {} } = {}) {
  return {
    id: 'game-test-001',
    phase,
    players,
    eventQueue: [],
    getPlayer(charId) { return this.players[charId]; },
    setPhase(p) { this.phase = p; },
    removePlayer(charId) { delete this.players[charId]; },
    addLogEntry() { return {}; },
  };
}

/** Stub de TimeWheel — captura los eventos programados */
function makeTimeWheel() {
  const scheduled = [];
  return {
    scheduleEvent: jest.fn((gameId, event) => scheduled.push(event)),
    _scheduled: scheduled,
  };
}

// ---------------------------------------------------------------------------
// startGame
// ---------------------------------------------------------------------------
describe('startGame', () => {
  afterEach(() => jest.restoreAllMocks());

  it('startGame_givenHostWithTwoPlayers_shouldSucceed', () => {
    const host = makePlayer({ characterId: 'char-1', isHost: true });
    const guest = makePlayer({ characterId: 'char-2' });
    const game = makeGame({ players: { 'char-1': host, 'char-2': guest } });
    const tw = makeTimeWheel();

    const result = startGame(game, 'char-1', tw, 300_000);

    expect(result.success).toBe(true);
    expect(game.phase).toBe('preparation');
  });

  it('startGame_givenNonHost_shouldFail', () => {
    const host = makePlayer({ characterId: 'char-1', isHost: true });
    const guest = makePlayer({ characterId: 'char-2', isHost: false });
    const game = makeGame({ players: { 'char-1': host, 'char-2': guest } });

    const result = startGame(game, 'char-2', makeTimeWheel(), 300_000);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/host/i);
  });

  it('startGame_givenOnlyOnePlayer_shouldFail', () => {
    const host = makePlayer({ characterId: 'char-1', isHost: true });
    const game = makeGame({ players: { 'char-1': host } });

    const result = startGame(game, 'char-1', makeTimeWheel(), 300_000);

    expect(result.success).toBe(false);
  });

  it('startGame_givenAlreadyStartedGame_shouldFail', () => {
    const host = makePlayer({ characterId: 'char-1', isHost: true });
    const game = makeGame({ phase: 'war', players: { 'char-1': host } });

    const result = startGame(game, 'char-1', makeTimeWheel(), 300_000);

    expect(result.success).toBe(false);
  });

  it('startGame_givenSuccess_shouldSchedulePhaseTransitionEvent', () => {
    const host = makePlayer({ characterId: 'char-1', isHost: true });
    const guest = makePlayer({ characterId: 'char-2' });
    const game = makeGame({ players: { 'char-1': host, 'char-2': guest } });
    const tw = makeTimeWheel();

    startGame(game, 'char-1', tw, 300_000);

    expect(tw.scheduleEvent).toHaveBeenCalledTimes(1);
    const event = tw._scheduled[0];
    expect(event.type).toBe('PHASE_TRANSITION_WAR');
  });
});

// ---------------------------------------------------------------------------
// trainTroop
// ---------------------------------------------------------------------------
describe('trainTroop', () => {
  afterEach(() => jest.restoreAllMocks());

  it('trainTroop_givenValidTroop_shouldSucceed', () => {
    const player = makePlayer({ economicCredits: 500 });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });

    const result = trainTroop(game, 'char-1', 'warrior', makeTimeWheel());

    expect(result.success).toBe(true);
    expect(player.economicCredits).toBe(400); // 500 - 100
  });

  it('trainTroop_givenInsufficientCredits_shouldFail', () => {
    const player = makePlayer({ economicCredits: 50 });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });

    const result = trainTroop(game, 'char-1', 'warrior', makeTimeWheel());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/insuficientes/i);
  });

  it('trainTroop_givenWaitingPhase_shouldFail', () => {
    const player = makePlayer();
    const game = makeGame({ phase: 'waiting', players: { 'char-1': player } });

    const result = trainTroop(game, 'char-1', 'warrior', makeTimeWheel());

    expect(result.success).toBe(false);
  });

  it('trainTroop_givenEliminatedPlayer_shouldFail', () => {
    const player = makePlayer({ eliminated: true });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });

    const result = trainTroop(game, 'char-1', 'warrior', makeTimeWheel());

    expect(result.success).toBe(false);
  });

  it('trainTroop_givenLockedTroop_shouldFail', () => {
    // 'berserker' requiere tech_berserker_2, que a su vez requiere tech_berserker_1
    const player = makePlayer({ unlockedResearches: [] });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });

    const result = trainTroop(game, 'char-1', 'berserker', makeTimeWheel());

    expect(result.success).toBe(false);
  });

  it('trainTroop_givenSuccess_shouldScheduleTrainingEvent', () => {
    const player = makePlayer({ economicCredits: 500 });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });
    const tw = makeTimeWheel();

    trainTroop(game, 'char-1', 'warrior', tw);

    const event = tw._scheduled[0];
    expect(event.type).toBe('TROOP_TRAINING_COMPLETE');
    expect(event.payload.troopTypeId).toBe('warrior');
  });

  it('trainTroop_givenQueueWithPendingItem_shouldChainAfterIt', () => {
    const futureTime = Date.now() + 60_000;
    const player = makePlayer({
      economicCredits: 500,
      trainingQueue: [{ trainingId: 'tid-1', troopTypeId: 'warrior', completesAt: futureTime }],
    });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });

    const result = trainTroop(game, 'char-1', 'warrior', makeTimeWheel());

    // La segunda tropa debe completarse después de la primera
    expect(result.completesAt).toBeGreaterThan(futureTime);
  });
});

// ---------------------------------------------------------------------------
// launchAttack
// ---------------------------------------------------------------------------
describe('launchAttack', () => {
  afterEach(() => jest.restoreAllMocks());

  it('launchAttack_givenValidAttack_shouldSucceed', () => {
    const troop = makeTroop('t-1');
    const attacker = makePlayer({ characterId: 'char-1', troops: [troop] });
    const defender = makePlayer({ characterId: 'char-2' });
    const game = makeGame({ phase: 'war', players: { 'char-1': attacker, 'char-2': defender } });

    const result = launchAttack(game, 'char-1', 'char-2', ['t-1'], makeTimeWheel());

    expect(result.success).toBe(true);
    expect(troop.deploy).toHaveBeenCalled();
  });

  it('launchAttack_givenPreparationPhase_shouldFail', () => {
    const attacker = makePlayer({ characterId: 'char-1', troops: [makeTroop('t-1')] });
    const defender = makePlayer({ characterId: 'char-2' });
    const game = makeGame({ phase: 'preparation', players: { 'char-1': attacker, 'char-2': defender } });

    const result = launchAttack(game, 'char-1', 'char-2', ['t-1'], makeTimeWheel());

    expect(result.success).toBe(false);
  });

  it('launchAttack_givenSelfAttack_shouldFail', () => {
    const attacker = makePlayer({ characterId: 'char-1', troops: [makeTroop('t-1')] });
    const game = makeGame({ phase: 'war', players: { 'char-1': attacker } });

    const result = launchAttack(game, 'char-1', 'char-1', ['t-1'], makeTimeWheel());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/propia capital/i);
  });

  it('launchAttack_givenEliminatedTarget_shouldFail', () => {
    const attacker = makePlayer({ characterId: 'char-1', troops: [makeTroop('t-1')] });
    const defender = makePlayer({ characterId: 'char-2', eliminated: true });
    const game = makeGame({ phase: 'war', players: { 'char-1': attacker, 'char-2': defender } });

    const result = launchAttack(game, 'char-1', 'char-2', ['t-1'], makeTimeWheel());

    expect(result.success).toBe(false);
  });

  it('launchAttack_givenEmptyTroopIds_shouldFail', () => {
    const attacker = makePlayer({ characterId: 'char-1' });
    const defender = makePlayer({ characterId: 'char-2' });
    const game = makeGame({ phase: 'war', players: { 'char-1': attacker, 'char-2': defender } });

    const result = launchAttack(game, 'char-1', 'char-2', [], makeTimeWheel());

    expect(result.success).toBe(false);
  });

  it('launchAttack_givenDeployedTroop_shouldFail', () => {
    const deployed = makeTroop('t-1', { deployed: true });
    const attacker = makePlayer({ characterId: 'char-1', troops: [deployed] });
    const defender = makePlayer({ characterId: 'char-2' });
    const game = makeGame({ phase: 'war', players: { 'char-1': attacker, 'char-2': defender } });

    const result = launchAttack(game, 'char-1', 'char-2', ['t-1'], makeTimeWheel());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/desplegada/i);
  });

  it('launchAttack_givenSuccess_shouldScheduleTroopArrivalEvent', () => {
    const troop = makeTroop('t-1');
    const attacker = makePlayer({ characterId: 'char-1', troops: [troop] });
    const defender = makePlayer({ characterId: 'char-2' });
    const game = makeGame({ phase: 'war', players: { 'char-1': attacker, 'char-2': defender } });
    const tw = makeTimeWheel();

    launchAttack(game, 'char-1', 'char-2', ['t-1'], tw);

    const event = tw._scheduled[0];
    expect(event.type).toBe('TROOP_ARRIVAL');
    expect(event.payload.targetCharacterId).toBe('char-2');
  });
});

// ---------------------------------------------------------------------------
// abandonGame
// ---------------------------------------------------------------------------
describe('abandonGame', () => {
  afterEach(() => jest.restoreAllMocks());

  it('abandonGame_givenActivePlayerInWar_shouldMarkAsEliminated', () => {
    const player = makePlayer({ characterId: 'char-1' });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });

    const result = abandonGame(game, 'char-1');

    expect(result.success).toBe(true);
    expect(player.eliminated).toBe(true);
    expect(player.capitalHealth).toBe(0);
  });

  it('abandonGame_givenWaitingPhase_shouldRemovePlayerFromLobby', () => {
    const player = makePlayer({ characterId: 'char-1' });
    const game = makeGame({ phase: 'waiting', players: { 'char-1': player } });

    const result = abandonGame(game, 'char-1');

    expect(result.success).toBe(true);
    expect(result.removed).toBe(true);
    expect(game.players['char-1']).toBeUndefined();
  });

  it('abandonGame_givenFinishedGame_shouldFail', () => {
    const player = makePlayer({ characterId: 'char-1' });
    const game = makeGame({ phase: 'finished', players: { 'char-1': player } });

    const result = abandonGame(game, 'char-1');

    expect(result.success).toBe(false);
  });

  it('abandonGame_givenAlreadyEliminated_shouldFail', () => {
    const player = makePlayer({ characterId: 'char-1', eliminated: true });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });

    const result = abandonGame(game, 'char-1');

    expect(result.success).toBe(false);
  });

  it('abandonGame_givenAbandon_shouldKeepDeployedTroopsActive', () => {
    // Las tropas en campaña siguen su curso aunque el jugador abandone
    const atHome = makeTroop('t-home', { deployed: false });
    const deployed = makeTroop('t-deployed', { deployed: true });
    const player = makePlayer({ characterId: 'char-1', troops: [atHome, deployed] });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });

    abandonGame(game, 'char-1');

    // Solo las tropas desplegadas permanecen
    expect(player.troops).toHaveLength(1);
    expect(player.troops[0]).toBe(deployed);
  });
});

// ---------------------------------------------------------------------------
// startResearch
// ---------------------------------------------------------------------------
describe('startResearch', () => {
  afterEach(() => jest.restoreAllMocks());

  it('startResearch_givenValidResearch_shouldSucceed', () => {
    const player = makePlayer({ researchCredits: 500 });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });

    const result = startResearch(game, 'char-1', 'tech_berserker_1', makeTimeWheel());

    expect(result.success).toBe(true);
    expect(player.researchCredits).toBe(300); // 500 - 200
    expect(player.researchInProgress).not.toBeNull();
  });

  it('startResearch_givenInsufficientCredits_shouldFail', () => {
    const player = makePlayer({ researchCredits: 50 });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });

    const result = startResearch(game, 'char-1', 'tech_berserker_1', makeTimeWheel());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/insuficientes/i);
  });

  it('startResearch_givenResearchAlreadyInProgress_shouldFail', () => {
    const player = makePlayer({
      researchCredits: 500,
      researchInProgress: { researchId: 'tech_berserker_1', completesAt: Date.now() + 10000 },
    });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });

    const result = startResearch(game, 'char-1', 'tech_berserker_1', makeTimeWheel());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/en curso/i);
  });

  it('startResearch_givenAlreadyUnlocked_shouldFail', () => {
    const player = makePlayer({
      researchCredits: 999,
      unlockedResearches: ['tech_berserker_1'],
    });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });

    const result = startResearch(game, 'char-1', 'tech_berserker_1', makeTimeWheel());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/ya ha sido desbloqueada/i);
  });

  it('startResearch_givenMissingRequirements_shouldFail', () => {
    // tech_berserker_2 requiere tech_berserker_1 que no está desbloqueada
    const player = makePlayer({ researchCredits: 999, unlockedResearches: [] });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });

    const result = startResearch(game, 'char-1', 'tech_berserker_2', makeTimeWheel());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/prerrequisitos/i);
  });

  it('startResearch_givenSuccess_shouldScheduleResearchCompleteEvent', () => {
    const player = makePlayer({ researchCredits: 500 });
    const game = makeGame({ phase: 'war', players: { 'char-1': player } });
    const tw = makeTimeWheel();

    startResearch(game, 'char-1', 'tech_berserker_1', tw);

    const event = tw._scheduled[0];
    expect(event.type).toBe('RESEARCH_COMPLETE');
    expect(event.payload.researchId).toBe('tech_berserker_1');
  });

  it('startResearch_givenWaitingPhase_shouldFail', () => {
    const player = makePlayer({ researchCredits: 999 });
    const game = makeGame({ phase: 'waiting', players: { 'char-1': player } });

    const result = startResearch(game, 'char-1', 'tech_berserker_1', makeTimeWheel());

    expect(result.success).toBe(false);
  });
});
