const SUIT_ALIASES = {
  s: 's',
  spade: 's',
  spades: 's',
  h: 'h',
  heart: 'h',
  hearts: 'h',
  d: 'd',
  diamond: 'd',
  diamonds: 'd',
  c: 'c',
  club: 'c',
  clubs: 'c',
};

const RANK_ALIASES = {
  A: { rank: 'A', value: 14 },
  K: { rank: 'K', value: 13 },
  Q: { rank: 'Q', value: 12 },
  J: { rank: 'J', value: 11 },
  T: { rank: 'T', value: 10 },
  '10': { rank: 'T', value: 10 },
  '9': { rank: '9', value: 9 },
  '8': { rank: '8', value: 8 },
  '7': { rank: '7', value: 7 },
  '6': { rank: '6', value: 6 },
  '5': { rank: '5', value: 5 },
  '4': { rank: '4', value: 4 },
  '3': { rank: '3', value: 3 },
  '2': { rank: '2', value: 2 },
};

const CANONICAL_SUITS = ['s', 'h', 'd', 'c'];
const ALL_SUITS = ['s', 'h', 'd', 'c'];
const ALL_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUIT_PERMUTATIONS = buildSuitPermutations(ALL_SUITS);
const SUIT_SORT_ORDER = { s: 0, h: 1, d: 2, c: 3 };

function normalizeRank(rank, value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return (
      {
        14: { rank: 'A', value: 14 },
        13: { rank: 'K', value: 13 },
        12: { rank: 'Q', value: 12 },
        11: { rank: 'J', value: 11 },
        10: { rank: 'T', value: 10 },
      }[value] || { rank: String(value), value }
    );
  }

  const normalized = String(rank || '').trim().toUpperCase();
  if (!RANK_ALIASES[normalized]) {
    throw new Error(`Unsupported rank: ${rank}`);
  }
  return RANK_ALIASES[normalized];
}

function normalizeSuit(suit) {
  const normalized = String(suit || '').trim().toLowerCase();
  if (!SUIT_ALIASES[normalized]) {
    throw new Error(`Unsupported suit: ${suit}`);
  }
  return SUIT_ALIASES[normalized];
}

function normalizeCard(card) {
  if (typeof card === 'string') {
    const match = card.trim().match(/^([2-9TJQKA])([shdc])$/i);
    if (!match) {
      throw new Error(`Unsupported card code: ${card}`);
    }
    const normalizedSuit = normalizeSuit(match[2]);
    const normalizedRank = normalizeRank(match[1]);
    return { rank: normalizedRank.rank, suit: normalizedSuit, value: normalizedRank.value };
  }

  const normalizedRank = normalizeRank(card?.rank, card?.value);
  const normalizedSuit = normalizeSuit(card?.suit);
  return { rank: normalizedRank.rank, suit: normalizedSuit, value: normalizedRank.value };
}

function cardCode(card) {
  const normalized = normalizeCard(card);
  return `${normalized.rank}${normalized.suit}`;
}

function compareCards(left, right) {
  const valueDelta = right.value - left.value;
  if (valueDelta !== 0) return valueDelta;
  return SUIT_SORT_ORDER[left.suit] - SUIT_SORT_ORDER[right.suit];
}

function sortCards(cards) {
  return [...(cards || [])].map(normalizeCard).sort(compareCards);
}

function canonicalizeSequence(cards, baseSuitMap = {}) {
  const suitMap = { ...baseSuitMap };
  const canonicalCards = [];

  for (const card of cards || []) {
    const normalized = normalizeCard(card);
    if (!suitMap[normalized.suit]) {
      suitMap[normalized.suit] = CANONICAL_SUITS[Object.keys(suitMap).length];
    }
    canonicalCards.push({
      rank: normalized.rank,
      suit: suitMap[normalized.suit],
      value: normalized.value,
    });
  }

  return { cards: canonicalCards, suitMap };
}

function buildSuitPermutations(suits) {
  if (suits.length === 1) return [suits];
  const permutations = [];
  for (let index = 0; index < suits.length; index++) {
    const head = suits[index];
    const tail = suits.slice(0, index).concat(suits.slice(index + 1));
    for (const permutation of buildSuitPermutations(tail)) {
      permutations.push([head, ...permutation]);
    }
  }
  return permutations;
}

function createSuitMap(permutation) {
  return ALL_SUITS.reduce((map, suit, index) => {
    map[suit] = permutation[index];
    return map;
  }, {});
}

function applySuitMap(cards, suitMap) {
  return [...(cards || [])].map((card) => {
    const normalized = normalizeCard(card);
    return {
      rank: normalized.rank,
      suit: suitMap[normalized.suit],
      value: normalized.value,
    };
  });
}

function serializeCards(cards) {
  return cards.map(cardCode).join('');
}

function serializeCardsForComparison(cards) {
  return cards
    .map((card) => {
      const normalized = normalizeCard(card);
      return `${normalized.rank}${SUIT_SORT_ORDER[normalized.suit]}`;
    })
    .join('');
}

function pickCanonicalPermutation(boardCards, holeCards = []) {
  let best = null;

  for (const permutation of SUIT_PERMUTATIONS) {
    const suitMap = createSuitMap(permutation);
    const transformedBoard = applySuitMap(boardCards, suitMap);
    const transformedHoleCards = applySuitMap(holeCards, suitMap);
    const flop = sortCards(transformedBoard.slice(0, 3));
    const trailing = transformedBoard.slice(3);
    const hole = sortCards(transformedHoleCards);
    const board = [...flop, ...trailing];
    const signature = `${serializeCardsForComparison(board)}|${serializeCardsForComparison(hole)}`;

    if (!best || signature < best.signature) {
      best = { board, flop, hole, suitMap, signature };
    }
  }

  return best;
}

function canonicalizeBoard(board) {
  const normalizedBoard = [...(board || [])].map(normalizeCard);
  const canonical = pickCanonicalPermutation(normalizedBoard);
  return {
    flop: canonical.flop,
    board: canonical.board,
    suitMap: canonical.suitMap,
  };
}

function canonicalizeHoleCards(holeCards, suitMap = {}) {
  return canonicalizeSequence(sortCards(holeCards), suitMap).cards;
}

function canonicalizeSolverState({ flop, board, holeCards }) {
  const sourceBoard = Array.isArray(board) && board.length > 0 ? board : flop || [];
  const canonical = pickCanonicalPermutation(sourceBoard, holeCards || []);
  return {
    flop: canonical.flop,
    board: canonical.board,
    holeCards: canonical.hole,
  };
}

function flopKey(flopCards) {
  return canonicalizeBoard(flopCards).flop.map(cardCode).join('');
}

function boardRunoutKey(board) {
  const canonicalBoard = canonicalizeBoard(board).board;
  if (canonicalBoard.length < 4) return null;
  if (canonicalBoard.length === 4) return cardCode(canonicalBoard[3]);
  return `${cardCode(canonicalBoard[3])}|${cardCode(canonicalBoard[4])}`;
}

function enumerateCanonicalFlops() {
  const deck = [];
  for (const rank of ALL_RANKS) {
    for (const suit of ALL_SUITS) {
      deck.push(normalizeCard(`${rank}${suit}`));
    }
  }

  const flops = new Set();
  for (let first = 0; first < deck.length - 2; first++) {
    for (let second = first + 1; second < deck.length - 1; second++) {
      for (let third = second + 1; third < deck.length; third++) {
        flops.add(flopKey([deck[first], deck[second], deck[third]]));
      }
    }
  }

  return [...flops].sort();
}

module.exports = {
  boardRunoutKey,
  canonicalizeBoard,
  canonicalizeHoleCards,
  canonicalizeSolverState,
  cardCode,
  compareCards,
  enumerateCanonicalFlops,
  flopKey,
  normalizeCard,
  sortCards,
};
