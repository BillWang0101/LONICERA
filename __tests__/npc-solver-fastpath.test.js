const path = require('path');
const { npcDecision } = require('../npc');
const { clearSolverLookupCache, warmStrategyTree } = require('../solver-lookup');

function card(rank, suit, value) {
  return { rank, suit, value };
}

describe('npc solver fast path', () => {
  beforeEach(() => {
    clearSolverLookupCache();
  });

  test('solver-enabled NPC uses solver strategy in supported HU postflop spots', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);

    try {
      const solverContext = {
        supported: true,
        positionPair: 'BTN_vs_BB',
        preflopLine: 'SRP',
        effectiveBB: 50,
        flop: [
          card('A', 'spades', 14),
          card('7', 'hearts', 7),
          card('2', 'diamonds', 2),
        ],
        actionLine: 'root',
      };
      await warmStrategyTree({
        solverContext,
        holeCards: [card('A', 'spades', 14), card('K', 'diamonds', 13)],
        dataDir: path.join(__dirname, 'fixtures', 'solver'),
      });

      const decision = npcDecision(
        {
          name: '诸葛亮',
          style: 'tricky',
          tightness: 0.5,
          bluffFreq: 0.35,
          aggression: 0,
          cbetFreq: 0.7,
          checkRaiseFreq: 0.25,
        },
        [card('A', 'spades', 14), card('K', 'diamonds', 13)],
        [
          card('A', 'spades', 14),
          card('7', 'hearts', 7),
          card('2', 'diamonds', 2),
        ],
        {
          pot: 100,
          currentBet: 0,
          playerBet: 0,
          chips: 1000,
          minRaise: 20,
          phase: 'flop',
          activePlayers: 2,
          seatIndex: 1,
          dealerIndex: 0,
          totalPlayers: 2,
          bigBlind: 20,
          psychMods: {},
          solverDataDir: path.join(__dirname, 'fixtures', 'solver'),
          solverContext,
        }
      );

      expect(decision).toEqual({ action: 'raise', amount: 77, _solver: true });
      expect(decision._solver).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });

  test('solver-enabled NPC records a hit trace when a supported strategy is applied', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);

    try {
      const solverContext = {
        supported: true,
        positionPair: 'BTN_vs_BB',
        preflopLine: 'SRP',
        effectiveBB: 50,
        flop: [
          card('A', 'spades', 14),
          card('7', 'hearts', 7),
          card('2', 'diamonds', 2),
        ],
        actionLine: 'root',
      };
      await warmStrategyTree({
        solverContext,
        holeCards: [card('A', 'spades', 14), card('K', 'diamonds', 13)],
        dataDir: path.join(__dirname, 'fixtures', 'solver'),
      });

      const gameState = {
        pot: 100,
        currentBet: 0,
        playerBet: 0,
        chips: 1000,
        minRaise: 20,
        phase: 'flop',
        activePlayers: 2,
        seatIndex: 1,
        dealerIndex: 0,
        totalPlayers: 2,
        bigBlind: 20,
        psychMods: {},
        solverDataDir: path.join(__dirname, 'fixtures', 'solver'),
        solverContext,
      };

      npcDecision(
        {
          name: '诸葛亮',
          style: 'tricky',
          tightness: 0.5,
          bluffFreq: 0.35,
          aggression: 0,
          cbetFreq: 0.7,
          checkRaiseFreq: 0.25,
        },
        [card('A', 'spades', 14), card('K', 'diamonds', 13)],
        [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
        gameState
      );

      expect(gameState._solverTrace).toMatchObject({
        status: 'hit',
        reason: 'solver_strategy_applied',
        preflopLine: 'SRP',
        stackBucket: 50,
        actionLine: 'root',
      });
    } finally {
      randomSpy.mockRestore();
    }
  });

  test('solver-enabled NPC records a fallback trace when no action-line node exists', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);

    try {
      const solverContext = {
        supported: true,
        positionPair: 'BTN_vs_BB',
        preflopLine: 'SRP',
        effectiveBB: 50,
        flop: [
          card('A', 'spades', 14),
          card('7', 'hearts', 7),
          card('2', 'diamonds', 2),
        ],
        actionLine: 'f_oop_x__f_ip_r250__f_oop_c',
      };
      await warmStrategyTree({
        solverContext: { ...solverContext, actionLine: 'root' },
        holeCards: [card('A', 'spades', 14), card('K', 'diamonds', 13)],
        dataDir: path.join(__dirname, 'fixtures', 'solver'),
      });

      const gameState = {
        pot: 100,
        currentBet: 0,
        playerBet: 0,
        chips: 1000,
        minRaise: 20,
        phase: 'flop',
        activePlayers: 2,
        seatIndex: 1,
        dealerIndex: 0,
        totalPlayers: 2,
        bigBlind: 20,
        psychMods: {},
        solverDataDir: path.join(__dirname, 'fixtures', 'solver'),
        solverContext,
      };

      const decision = npcDecision(
        {
          name: '诸葛亮',
          style: 'tricky',
          tightness: 0.5,
          bluffFreq: 0.35,
          aggression: 0,
          cbetFreq: 0.7,
          checkRaiseFreq: 0.25,
        },
        [card('A', 'spades', 14), card('K', 'diamonds', 13)],
        [card('A', 'spades', 14), card('7', 'hearts', 7), card('2', 'diamonds', 2)],
        gameState
      );

      expect(decision._solver).not.toBe(true);
      expect(gameState._solverTrace).toMatchObject({
        status: 'fallback',
        reason: 'node_missing_for_action_line',
        preflopLine: 'SRP',
        stackBucket: 50,
        actionLine: 'f_oop_x__f_ip_r250__f_oop_c',
      });
    } finally {
      randomSpy.mockRestore();
    }
  });
});
