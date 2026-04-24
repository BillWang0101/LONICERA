const path = require('path');
const { clearSolverLookupCache, warmStrategyTree } = require('../solver-lookup');
const { decideNpcAction } = require('../npc-orchestrator');
const { NPC_PROFILES } = require('../npc');
const {
  applyPersonaDeviation,
  isSolverEligibleProfile,
  SOLVER_ENABLED_NPCS,
} = require('../solver-persona');

function card(rank, suit, value) {
  return { rank, suit, value };
}

describe('npc orchestrator', () => {
  beforeEach(() => {
    clearSolverLookupCache();
  });

  test('prefers solver exact hit over remote model policy', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      const solverContext = {
        supported: true,
        positionPair: 'BTN_vs_BB',
        preflopLine: 'SRP',
        effectiveBB: 50,
        flop: [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
        board: [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
        actionLine: 'root',
        heroRole: 'OOP',
      };
      await warmStrategyTree({
        solverContext,
        holeCards: [card('A', 'spades', 14), card('K', 'diamonds', 13)],
        dataDir: path.join(__dirname, 'fixtures', 'solver'),
      });

      const remoteClient = jest.fn();
      const gameState = {
        pot: 100,
        currentBet: 0,
        playerBet: 0,
        chips: 1000,
        minRaise: 20,
        phase: 'flop',
        activePlayers: 2,
        bigBlind: 20,
        psychMods: {},
        solverDataDir: path.join(__dirname, 'fixtures', 'solver'),
        solverContext,
      };

      const decision = await decideNpcAction({
        profile: {
          name: [...SOLVER_ENABLED_NPCS][0],
          style: 'tricky',
          tightness: 0.5,
          bluffFreq: 0.35,
          aggression: 0,
          cbetFreq: 0.7,
          checkRaiseFreq: 0.25,
        },
        holeCards: [card('A', 'spades', 14), card('K', 'diamonds', 13)],
        communityCards: [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
        gameState,
        players: [],
        remoteClient,
      });

      expect(decision).toMatchObject({ action: 'raise', _solver: true, _decisionSource: 'solver_hit' });
      expect(remoteClient).not.toHaveBeenCalled();
    } finally {
      randomSpy.mockRestore();
    }
  });

  test('allows any checked-in NPC profile to use solver exact hits', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      const solverContext = {
        supported: true,
        positionPair: 'BTN_vs_BB',
        preflopLine: 'SRP',
        effectiveBB: 50,
        flop: [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
        board: [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
        actionLine: 'root',
        heroRole: 'OOP',
      };
      await warmStrategyTree({
        solverContext,
        holeCards: [card('A', 'spades', 14), card('K', 'diamonds', 13)],
        dataDir: path.join(__dirname, 'fixtures', 'solver'),
      });

      const profile = NPC_PROFILES.find((npc) => !SOLVER_ENABLED_NPCS.has(npc.name));
      expect(profile).toBeTruthy();
      expect(isSolverEligibleProfile(profile)).toBe(true);

      const remoteClient = jest.fn();
      const gameState = {
        pot: 100,
        currentBet: 0,
        playerBet: 0,
        chips: 1000,
        minRaise: 20,
        phase: 'flop',
        activePlayers: 2,
        bigBlind: 20,
        psychMods: {},
        solverDataDir: path.join(__dirname, 'fixtures', 'solver'),
        solverContext,
      };

      const decision = await decideNpcAction({
        profile,
        holeCards: [card('A', 'spades', 14), card('K', 'diamonds', 13)],
        communityCards: [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
        gameState,
        players: [],
        remoteClient,
      });

      expect(decision).toMatchObject({ action: 'raise', _solver: true, _decisionSource: 'solver_hit' });
      expect(remoteClient).not.toHaveBeenCalled();
    } finally {
      randomSpy.mockRestore();
    }
  });

  test('uses remote model policy when spot is covered and solver does not hit', async () => {
    const gameState = {
      pot: 100,
      currentBet: 0,
      playerBet: 0,
      chips: 1000,
      minRaise: 20,
      phase: 'flop',
      activePlayers: 2,
      bigBlind: 20,
      psychMods: {},
      solverContext: {
        supported: true,
        positionPair: 'BTN_vs_BB',
        preflopLine: 'SRP',
        effectiveBB: 50,
        flop: [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
        board: [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
        actionLine: 'root',
        heroRole: 'OOP',
      },
    };

    const decision = await decideNpcAction({
      profile: {
        name: 'NotEnabled',
        style: 'balanced',
        tightness: 0.5,
        bluffFreq: 0.2,
        aggression: 0.5,
        cbetFreq: 0.6,
        checkRaiseFreq: 0.1,
      },
      holeCards: [card('A', 'spades', 14), card('Q', 'diamonds', 12)],
      communityCards: [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
      gameState,
      players: [],
      remoteConfig: {
        enabled: true,
        url: 'http://127.0.0.1:8900',
        timeoutMs: 800,
        minConfidence: 0.18,
      },
      remoteClient: jest.fn().mockResolvedValue({
        policy: { check: 0.2, bet_75: 0.8, fold: 0.1 },
        selectedAction: 'bet_75',
        confidence: 0.74,
        latencyMs: 32,
        modelVersion: 'test-model',
        coverageStatus: 'covered_spot',
      }),
    });

    expect(decision).toMatchObject({
      action: 'raise',
      amount: 75,
      _model: true,
      _decisionSource: 'model_hit',
    });
    expect(gameState._decisionTrace).toMatchObject({
      status: 'model_hit',
      selectedAction: 'bet_75',
      modelVersion: 'test-model',
    });
  });

  test('falls back when remote model times out', async () => {
    const gameState = {
      pot: 100,
      currentBet: 0,
      playerBet: 0,
      chips: 1000,
      minRaise: 20,
      phase: 'flop',
      activePlayers: 2,
      bigBlind: 20,
      psychMods: {},
      solverContext: {
        supported: true,
        positionPair: 'BTN_vs_BB',
        preflopLine: 'SRP',
        effectiveBB: 50,
        flop: [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
        board: [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
        actionLine: 'root',
        heroRole: 'OOP',
      },
      opponentActions: {},
      opponentProfiles: {},
      _myHandActions: [],
      _myRecentActions: [],
    };

    const decision = await decideNpcAction({
      profile: {
        name: 'NotEnabled',
        style: 'balanced',
        tightness: 0.5,
        bluffFreq: 0.2,
        aggression: 0.5,
        cbetFreq: 0.6,
        checkRaiseFreq: 0.1,
      },
      holeCards: [card('A', 'spades', 14), card('Q', 'diamonds', 12)],
      communityCards: [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
      gameState,
      players: [],
      remoteConfig: {
        enabled: true,
        url: 'http://127.0.0.1:8900',
        timeoutMs: 800,
        minConfidence: 0.18,
      },
      remoteClient: jest.fn().mockRejectedValue(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })),
    });

    expect(decision._decisionSource).toBe('fallback');
    expect(gameState._decisionTrace).toMatchObject({
      status: 'fallback',
      reason: 'model_timeout',
    });
  });
});

describe('persona deviation guardrails', () => {
  test('never reintroduces disallowed actions and caps per-action shift', () => {
    const base = { check: 0.4, bet_75: 0.4, bet_130: 0.2 };
    const shifted = applyPersonaDeviation(
      base,
      { name: '鍚寸敤', bluffFreq: 0.35, aggression: 0.7 },
      {},
      {
        allowedActions: ['check', 'bet_75'],
        confidence: 0.95,
        maxTotalShift: 0.05,
      }
    );

    expect(Object.keys(shifted).sort()).toEqual(['bet_75', 'check']);
    expect(Math.abs((shifted.bet_75 || 0) - 0.5)).toBeLessThanOrEqual(0.051);
  });
});
