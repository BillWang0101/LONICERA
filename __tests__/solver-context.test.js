const { buildActionLine, buildSolverContext, inferPreflopLine } = require('../solver-context');

function player(id, overrides = {}) {
  return {
    id,
    folded: false,
    chips: 1000,
    ...overrides,
  };
}

function action(overrides = {}) {
  return {
    phase: 'preflop',
    playerId: 'btn',
    action: 'call',
    amount: 0,
    contribution: 0,
    potBeforeAction: 0,
    potAfterAction: 0,
    currentBetBeforeAction: 0,
    currentBetAfterAction: 0,
    playerBetBeforeAction: 0,
    playerBetAfterAction: 0,
    toCallBeforeAction: 0,
    chipsBeforeAction: 1000,
    chipsAfterAction: 1000,
    ...overrides,
  };
}

function board() {
  return [
    { rank: 'A', suit: 'spades', value: 14 },
    { rank: '7', suit: 'hearts', value: 7 },
    { rank: '2', suit: 'diamonds', value: 2 },
  ];
}

describe('solver-context', () => {
  test('classifies single-raised and 3-bet preflop lines', () => {
    const srp = inferPreflopLine([
      action({ phase: 'preflop', playerId: 'btn', action: 'raise' }),
      action({ phase: 'preflop', playerId: 'bb', action: 'call' }),
    ]);
    const threeBet = inferPreflopLine([
      action({ phase: 'preflop', playerId: 'btn', action: 'raise' }),
      action({ phase: 'preflop', playerId: 'bb', action: 'raise' }),
      action({ phase: 'preflop', playerId: 'btn', action: 'call' }),
    ]);

    expect(srp).toBe('SRP');
    expect(threeBet).toBe('3BP');
  });

  test('rejects unsupported preflop all-in lines', () => {
    const line = inferPreflopLine([
      action({ phase: 'preflop', playerId: 'btn', action: 'allin' }),
      action({ phase: 'preflop', playerId: 'bb', action: 'call' }),
    ]);

    expect(line).toBeNull();
  });

  test('builds canonical postflop action lines with bucketed bet sizes', () => {
    const line = buildActionLine({
      currentPhase: 'turn',
      ipPlayerId: 'btn',
      oopPlayerId: 'bb',
      actions: [
        action({ phase: 'preflop', playerId: 'btn', action: 'raise' }),
        action({ phase: 'preflop', playerId: 'bb', action: 'call' }),
        action({ phase: 'flop', playerId: 'bb', action: 'check' }),
        action({
          phase: 'flop',
          playerId: 'btn',
          action: 'raise',
          contribution: 70,
          potBeforeAction: 100,
          currentBetBeforeAction: 0,
          playerBetAfterAction: 70,
          toCallBeforeAction: 0,
        }),
        action({ phase: 'flop', playerId: 'bb', action: 'call' }),
      ],
    });

    expect(line).toBe('f_oop_x__f_ip_b75__f_oop_c');
  });

  test('builds a supported BTN-vs-BB solver context for true heads-up hands', () => {
    const context = buildSolverContext({
      players: [player('btn'), player('bb')],
      currentPlayerId: 'bb',
      dealerIndex: 0,
      bbIndex: 1,
      handStartPlayerCount: 2,
      handStartStacks: { btn: 1000, bb: 1000 },
      handActionLog: [
        action({ phase: 'preflop', playerId: 'btn', action: 'raise' }),
        action({ phase: 'preflop', playerId: 'bb', action: 'call' }),
      ],
      bigBlind: 20,
      phase: 'flop',
      communityCards: board(),
    });

    expect(context.supported).toBe(true);
    expect(context.positionPair).toBe('BTN_vs_BB');
    expect(context.heroRole).toBe('OOP');
    expect(context.preflopLine).toBe('SRP');
    expect(context.takeoverMode).toBe('strict_hu');
    expect(context.effectiveBB).toBe(50);
    expect(context.actionLine).toBe('root');
  });

  test('supports safe multiway-to-HU takeover when preflop folds isolate BTN and BB', () => {
    const context = buildSolverContext({
      players: [player('btn'), player('co', { folded: true }), player('bb')],
      currentPlayerId: 'bb',
      dealerIndex: 0,
      bbIndex: 2,
      handStartPlayerCount: 3,
      handStartStacks: { btn: 1000, co: 1000, bb: 1000 },
      handActionLog: [
        action({ phase: 'preflop', playerId: 'btn', action: 'raise' }),
        action({ phase: 'preflop', playerId: 'co', action: 'fold' }),
        action({ phase: 'preflop', playerId: 'bb', action: 'call' }),
      ],
      bigBlind: 20,
      phase: 'flop',
      communityCards: board(),
    });

    expect(context.supported).toBe(true);
    expect(context.takeoverMode).toBe('safe_multiway_to_hu');
    expect(context.takeoverReason).toBe('multiway_preflop_folded_to_btn_vs_bb_srp');
    expect(context.positionPair).toBe('BTN_vs_BB');
    expect(context.heroRole).toBe('OOP');
    expect(context.preflopLine).toBe('SRP');
  });

  test('rejects unsafe multiway-to-HU spots when a third player entered preflop', () => {
    const context = buildSolverContext({
      players: [player('btn'), player('co', { folded: true }), player('bb')],
      currentPlayerId: 'bb',
      dealerIndex: 0,
      bbIndex: 2,
      handStartPlayerCount: 3,
      handStartStacks: { btn: 1000, co: 1000, bb: 1000 },
      handActionLog: [
        action({ phase: 'preflop', playerId: 'btn', action: 'raise' }),
        action({ phase: 'preflop', playerId: 'co', action: 'call' }),
        action({ phase: 'preflop', playerId: 'bb', action: 'call' }),
        action({ phase: 'flop', playerId: 'co', action: 'fold' }),
      ],
      bigBlind: 20,
      phase: 'flop',
      communityCards: board(),
    });

    expect(context).toEqual({
      supported: false,
      reason: 'hand_not_started_heads_up',
    });
  });
});
