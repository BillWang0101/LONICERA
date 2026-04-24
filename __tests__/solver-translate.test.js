const {
  listLegalActionsForGameState,
  translatePolicyDecision,
} = require('../solver-translate');

describe('solver translate generic policy helpers', () => {
  test('lists only legal actions for check-through states', () => {
    const legal = listLegalActionsForGameState({
      pot: 100,
      currentBet: 0,
      playerBet: 0,
      chips: 500,
      minRaise: 20,
    });

    expect(legal).toEqual(expect.arrayContaining(['check', 'bet_33', 'bet_75', 'bet_130', 'allin']));
    expect(legal).not.toEqual(expect.arrayContaining(['fold', 'call', 'raise_250']));
  });

  test('ignores invalid selectedAction and falls back to a legal sampled action', () => {
    const decision = translatePolicyDecision(
      {
        policy: { check: 0.1, bet_75: 0.9, fold: 0.4 },
        selectedAction: 'fold',
      },
      {
        pot: 100,
        currentBet: 0,
        playerBet: 0,
        chips: 500,
        minRaise: 20,
      },
      () => 0.8
    );

    expect(decision).toMatchObject({
      action: 'raise',
      amount: 75,
      selectedAction: 'bet_75',
    });
  });
});
