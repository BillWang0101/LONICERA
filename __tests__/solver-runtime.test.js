const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyHand } = require('../preflop-charts');
const {
  clearSolverLookupCache,
  flopKey,
  lookupStrategy,
  lookupStrategyDetailed,
  warmStrategyTree,
} = require('../solver-lookup');
const {
  normalizeStrategyForGameState,
  solverDecisionFromStrategy,
  translateChosenAction,
} = require('../solver-translate');

function card(rank, suit, value) {
  return { rank, suit, value };
}

describe('solver runtime helpers', () => {
  const fixtureDir = path.join(__dirname, 'fixtures', 'solver');
  const solverContext = {
    supported: true,
    positionPair: 'BTN_vs_BB',
    preflopLine: 'SRP',
    effectiveBB: 52,
    flop: [
      card('A', 'spades', 14),
      card('7', 'hearts', 7),
      card('2', 'diamonds', 2),
    ],
    actionLine: 'root',
  };

  beforeEach(() => {
    clearSolverLookupCache();
  });

  test('lookupStrategy prefers exact combo data and falls back to hand class', () => {
    const exactCombo = lookupStrategy({
      solverContext,
      holeCards: [card('A', 'spades', 14), card('K', 'diamonds', 13)],
      dataDir: fixtureDir,
    });
    const classFallback = lookupStrategy({
      solverContext,
      holeCards: [card('A', 'clubs', 14), card('K', 'diamonds', 13)],
      dataDir: fixtureDir,
    });

    expect(exactCombo).toEqual({ check: 0.2, bet_75: 0.8 });
    expect(classFallback).toEqual({ check: 0.65, bet_75: 0.35 });
    expect(classifyHand([card('A', 'clubs', 14), card('K', 'diamonds', 13)]).key).toBe('AKo');
  });

  test('lookupStrategy resolves action-line specific nodes', () => {
    const strategy = lookupStrategy({
      solverContext: { ...solverContext, actionLine: 'f_oop_x' },
      holeCards: [card('A', 'clubs', 14), card('K', 'diamonds', 13)],
      dataDir: fixtureDir,
    });

    expect(strategy).toEqual({ check: 0.4, bet_33: 0.6 });
  });

  test('lookupStrategy resolves suit-isomorphic boards through canonical files', () => {
    const strategy = lookupStrategy({
      solverContext: {
        ...solverContext,
        flop: [card('A', 'clubs', 14), card('7', 'diamonds', 7), card('2', 'hearts', 2)],
      },
      holeCards: [card('A', 'clubs', 14), card('K', 'hearts', 13)],
      dataDir: fixtureDir,
    });

    expect(strategy).toEqual({ check: 0.2, bet_75: 0.8 });
  });

  test('lookupStrategyDetailed reports a miss reason when the action-line node is absent', async () => {
    await warmStrategyTree({
      solverContext,
      holeCards: [card('A', 'clubs', 14), card('K', 'diamonds', 13)],
      dataDir: fixtureDir,
    });

    const result = lookupStrategyDetailed({
      solverContext: { ...solverContext, actionLine: 'f_oop_x__f_ip_r250__f_oop_c' },
      holeCards: [card('A', 'clubs', 14), card('K', 'diamonds', 13)],
      dataDir: fixtureDir,
    });

    expect(result.strategy).toBeNull();
    expect(result.meta.hit).toBe(false);
    expect(result.meta.reason).toBe('node_missing_for_action_line');
    expect(result.meta.classification).toBe('data_gap');
    expect(result.meta.preflopLine).toBe('SRP');
    expect(result.meta.stackBucket).toBe(50);
  });

  test('lookupStrategyDetailed returns tree_loading before warmup completes', async () => {
    const coldResult = lookupStrategyDetailed({
      solverContext,
      holeCards: [card('A', 'clubs', 14), card('K', 'diamonds', 13)],
      dataDir: fixtureDir,
    });

    expect(coldResult.strategy).toBeNull();
    expect(coldResult.meta.hit).toBe(false);
    expect(coldResult.meta.reason).toBe('tree_loading');
    expect(coldResult.meta.classification).toBe('cold_load');
    expect(coldResult.meta.lookupMs).toBeGreaterThanOrEqual(0);

    await warmStrategyTree({
      solverContext,
      holeCards: [card('A', 'clubs', 14), card('K', 'diamonds', 13)],
      dataDir: fixtureDir,
    });

    const warmResult = lookupStrategyDetailed({
      solverContext,
      holeCards: [card('A', 'clubs', 14), card('K', 'diamonds', 13)],
      dataDir: fixtureDir,
    });

    expect(warmResult.strategy).toEqual({ check: 0.65, bet_75: 0.35 });
    expect(warmResult.meta.hit).toBe(true);
    expect(warmResult.meta.reason).toBe('ok');
    expect(warmResult.meta.classification).toBe('solver_hit');
  });

  test('warmStrategyTree builds a compact flop-node cache and lookupStrategyDetailed hits it immediately', async () => {
    const rootCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-root-cache-'));
    const holeCards = [card('A', 'clubs', 14), card('K', 'diamonds', 13)];
    const rootCacheFile = path.join(
      rootCacheDir,
      solverContext.positionPair,
      `${solverContext.preflopLine}_50bb`,
      `flop_${flopKey(solverContext.flop)}.json`
    );
    const fullFile = path.join(
      fixtureDir,
      solverContext.positionPair,
      `${solverContext.preflopLine}_50bb`,
      `flop_${flopKey(solverContext.flop)}.json`
    );

    try {
      await warmStrategyTree({
        solverContext,
        holeCards,
        dataDir: fixtureDir,
        rootCacheDir,
      });

      expect(fs.existsSync(rootCacheFile)).toBe(true);
      expect(fs.statSync(rootCacheFile).size).toBeLessThan(fs.statSync(fullFile).size);
      expect(JSON.parse(fs.readFileSync(rootCacheFile, 'utf8')).nodes.f_oop_x).toBeTruthy();

      clearSolverLookupCache();

      const cachedResult = lookupStrategyDetailed({
        solverContext,
        holeCards,
        dataDir: fixtureDir,
        rootCacheDir,
      });

      expect(cachedResult.strategy).toEqual({ check: 0.65, bet_75: 0.35 });
      expect(cachedResult.meta.reason).toBe('ok');
      expect(cachedResult.meta.lookupSource).toBe('root_cache');

      const actionLineResult = lookupStrategyDetailed({
        solverContext: { ...solverContext, actionLine: 'f_oop_x' },
        holeCards,
        dataDir: fixtureDir,
        rootCacheDir,
      });

      expect(actionLineResult.strategy).toEqual({ check: 0.4, bet_33: 0.6 });
      expect(actionLineResult.meta.reason).toBe('ok');
      expect(actionLineResult.meta.lookupSource).toBe('root_cache');
    } finally {
      fs.rmSync(rootCacheDir, { recursive: true, force: true });
    }
  });

  test('normalizeStrategyForGameState removes impossible actions', () => {
    const normalized = normalizeStrategyForGameState(
      { check: 0.4, call: 0.3, bet_75: 0.3 },
      { currentBet: 0, playerBet: 0 }
    );

    expect(normalized).toEqual({ check: 0.5714285714285715, bet_75: 0.4285714285714286 });
  });

  test('translateChosenAction maps solver bets and raises onto engine actions', () => {
    expect(
      translateChosenAction('bet_75', {
        pot: 100,
        currentBet: 0,
        playerBet: 0,
        chips: 500,
        minRaise: 20,
      })
    ).toEqual({ action: 'raise', amount: 75 });

    expect(
      translateChosenAction('raise_250', {
        pot: 200,
        currentBet: 80,
        playerBet: 0,
        chips: 500,
        minRaise: 180,
      })
    ).toEqual({ action: 'raise', amount: 200 });
  });

  test('solverDecisionFromStrategy samples a legal translated action', () => {
    const decision = solverDecisionFromStrategy(
      { fold: 0.1, call: 0.2, raise_250: 0.7 },
      {
        pot: 200,
        currentBet: 80,
        playerBet: 0,
        chips: 500,
        minRaise: 180,
      },
      () => 0.95
    );

    expect(decision).toEqual({ action: 'raise', amount: 200 });
  });
});
