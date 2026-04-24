const {
  canonicalizeSolverState,
  cardCode,
  enumerateCanonicalFlops,
  flopKey,
} = require('../solver-board');

function card(rank, suit, value) {
  return { rank, suit, value };
}

describe('solver board helpers', () => {
  test('canonicalizes suit-isomorphic boards and hole cards consistently', () => {
    const canonical = canonicalizeSolverState({
      board: [
        card('A', 'clubs', 14),
        card('7', 'diamonds', 7),
        card('2', 'hearts', 2),
        card('K', 'clubs', 13),
      ],
      holeCards: [card('A', 'clubs', 14), card('K', 'hearts', 13)],
    });

    expect(canonical.flop.map(cardCode)).toEqual(['As', '7h', '2d']);
    expect(canonical.board.map(cardCode)).toEqual(['As', '7h', '2d', 'Ks']);
    expect(canonical.holeCards.map(cardCode)).toEqual(['As', 'Kd']);
  });

  test('enumerates 1755 canonical flop classes', () => {
    const flops = enumerateCanonicalFlops();

    expect(flops).toHaveLength(1755);
    expect(flops[0]).toMatch(/^[2-9TJQKA][shdc]{1}[2-9TJQKA][shdc]{1}[2-9TJQKA][shdc]{1}$/);
    expect(flops).toContain(flopKey(['Ac', '7d', '2h']));
  });
});
