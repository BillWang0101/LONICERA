const { PokerGame } = require('../engine');

describe('room host state', () => {
  test('marks the matching human player as host in player-specific state', () => {
    const game = new PokerGame('host-room');
    game.addPlayer({ id: 'p1', name: 'Alice' });
    game.addPlayer({ id: 'p2', name: 'Bob' });
    game.hostPlayerName = 'Alice';

    expect(game.getStateForPlayer('p1')).toMatchObject({
      hostName: 'Alice',
      isHost: true,
    });
    expect(game.getStateForPlayer('p2')).toMatchObject({
      hostName: 'Alice',
      isHost: false,
    });
  });
});
