const { normalizeSolverTree } = require('../solver-normalize');
const { lookupStrategy } = require('../solver-lookup');
const path = require('path');

function combo(actions, values) {
  return { actions, strategy: values };
}

describe('solver normalizer', () => {
  test('normalizes raw TexasSolver trees into board-aware runtime format', () => {
    const raw = {
      node_type: 'action_node',
      player: 1,
      strategy: combo(['CHECK', 'BET 33.000000'], {
        AsKd: [0.25, 0.75],
        AcKd: [0.5, 0.5],
      }),
      childrens: {
        CHECK: {
          node_type: 'chance_node',
          dealcards: {
            '2c': {
              node_type: 'action_node',
              player: 0,
              strategy: combo(['CHECK', 'BET 50.000000'], {
                AsKd: [0.4, 0.6],
              }),
              childrens: {
                CHECK: {
                  node_type: 'chance_node',
                  dealcards: {
                    Ah: {
                      node_type: 'action_node',
                      player: 1,
                      strategy: combo(['CHECK', 'BET 100.000000'], {
                        AsKd: [0.1, 0.9],
                      }),
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const normalized = normalizeSolverTree(raw);

    expect(normalized.nodes.root.strategyByCombo.AsKd).toEqual({ check: 0.25, bet_33: 0.75 });
    expect(normalized.nodes.root.strategyByHandClass.AKo).toEqual({ check: 0.375, bet_33: 0.625 });
    expect(normalized.turn['2c'].nodes.f_oop_x.strategyByCombo.AsKd).toEqual({
      check: 0.4,
      bet_50: 0.6,
    });
    expect(normalized.river['2c|Ah'].nodes.f_oop_x__t_ip_x.strategyByCombo.AsKd).toEqual({
      check: 0.1,
      bet_100: 0.9,
    });
  });

  test('lookupStrategy can read normalized turn and river nodes', () => {
    const fixtureDir = path.join(__dirname, 'fixtures', 'solver');

    const turnStrategy = lookupStrategy({
      solverContext: {
        supported: true,
        positionPair: 'BTN_vs_BB',
        preflopLine: 'SRP',
        effectiveBB: 50,
        flop: [
          { rank: 'A', suit: 'spades', value: 14 },
          { rank: '7', suit: 'hearts', value: 7 },
          { rank: '2', suit: 'diamonds', value: 2 },
        ],
        board: [
          { rank: 'A', suit: 'spades', value: 14 },
          { rank: '7', suit: 'hearts', value: 7 },
          { rank: '2', suit: 'diamonds', value: 2 },
          { rank: '2', suit: 'clubs', value: 2 },
        ],
        actionLine: 'f_oop_x',
      },
      holeCards: [
        { rank: 'A', suit: 'spades', value: 14 },
        { rank: 'K', suit: 'diamonds', value: 13 },
      ],
      dataDir: fixtureDir,
    });

    const riverStrategy = lookupStrategy({
      solverContext: {
        supported: true,
        positionPair: 'BTN_vs_BB',
        preflopLine: 'SRP',
        effectiveBB: 50,
        flop: [
          { rank: 'A', suit: 'spades', value: 14 },
          { rank: '7', suit: 'hearts', value: 7 },
          { rank: '2', suit: 'diamonds', value: 2 },
        ],
        board: [
          { rank: 'A', suit: 'spades', value: 14 },
          { rank: '7', suit: 'hearts', value: 7 },
          { rank: '2', suit: 'diamonds', value: 2 },
          { rank: '2', suit: 'clubs', value: 2 },
          { rank: 'A', suit: 'hearts', value: 14 },
        ],
        actionLine: 'f_oop_x__t_ip_x',
      },
      holeCards: [
        { rank: 'A', suit: 'spades', value: 14 },
        { rank: 'K', suit: 'diamonds', value: 13 },
      ],
      dataDir: fixtureDir,
    });

    expect(turnStrategy).toEqual({ check: 0.4, bet_50: 0.6 });
    expect(riverStrategy).toEqual({ check: 0.1, bet_100: 0.9 });
  });
});
