jest.mock('../solver-lookup', () => ({
  warmStrategyTree: jest.fn(),
}));

const { warmStrategyTree } = require('../solver-lookup');
const { PokerGame } = require('../engine');

describe('engine solver prewarm', () => {
  test('prewarms solver trees for automated players when the flop arrives', () => {
    const game = new PokerGame('solver_prewarm_room', {
      smallBlind: 10,
      bigBlind: 20,
      solverRootCacheDir: 'C:\\solver-root-cache',
    });
    game.onMessage = () => {};
    game.onUpdate = () => {};
    game.onChat = () => {};
    game.onRoundEnd = () => {};

    const npc = game.addPlayer({
      id: 'n1',
      name: 'Bot',
      isNPC: true,
      npcProfile: {
        name: 'Bot',
        style: 'balanced',
        tightness: 0.5,
        bluffFreq: 0.2,
        aggression: 0.5,
        cbetFreq: 0.6,
        checkRaiseFreq: 0.1,
      },
    });
    game.addPlayer({ id: 'h1', name: 'Hero' });

    game.startRound();
    warmStrategyTree.mockClear();
    game.handActionLog = [
      {
        phase: 'preflop',
        action: 'raise',
      },
    ];

    game.nextPhase();

    expect(game.phase).toBe('flop');
    expect(warmStrategyTree.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(warmStrategyTree.mock.calls.length).toBeLessThanOrEqual(2);
    for (const [callArg] of warmStrategyTree.mock.calls) {
      expect(callArg.holeCards).toEqual(npc.holeCards);
      expect(callArg.solverContext).toMatchObject({
        phase: 'flop',
        positionPair: 'BTN_vs_BB',
        preflopLine: 'SRP',
      });
      expect(callArg.rootCacheDir).toBe('C:\\solver-root-cache');
    }
  });
});
