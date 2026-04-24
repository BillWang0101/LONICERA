// preflop-table.js - Preflop Equity Lookup Table
// Computed once at server startup, cached in memory forever
// 169 hand types × 1-7 opponents × 10000 MC sims each

const { createDeck, shuffle } = require('./deck');
const { evaluateHand, compareHands } = require('./hand-eval');

// 169 canonical hand types in Texas Hold'em
// Format: "XYs" = suited, "XYo" = offsuit, "XX" = pair
function getHandKey(c1, c2) {
  const high = c1.value >= c2.value ? c1 : c2;
  const low = c1.value >= c2.value ? c2 : c1;
  const suited = c1.suit === c2.suit;

  const rankChar = (v) => {
    if (v === 14) return 'A';
    if (v === 13) return 'K';
    if (v === 12) return 'Q';
    if (v === 11) return 'J';
    if (v === 10) return 'T';
    return String(v);
  };

  const h = rankChar(high.value);
  const l = rankChar(low.value);

  if (high.value === low.value) return h + l; // Pair: "AA", "KK"
  return h + l + (suited ? 's' : 'o'); // "AKs", "AKo"
}

// Generate all 169 unique hand types
function generate169HandTypes() {
  const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
  const types = [];

  for (let i = 0; i < ranks.length; i++) {
    // Pairs
    types.push(ranks[i] + ranks[i]);
    // Suited and offsuit combos
    for (let j = i + 1; j < ranks.length; j++) {
      types.push(ranks[i] + ranks[j] + 's');
      types.push(ranks[i] + ranks[j] + 'o');
    }
  }
  return types;
}

// Get a concrete hand matching a hand type
function getConcreteHand(handType) {
  const rankToValue = {
    A: 14,
    K: 13,
    Q: 12,
    J: 11,
    T: 10,
    9: 9,
    8: 8,
    7: 7,
    6: 6,
    5: 5,
    4: 4,
    3: 3,
    2: 2,
  };
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];

  const r1 = handType[0];
  const r2 = handType[1];
  const modifier = handType[2]; // 's', 'o', or undefined (pair)

  const v1 = rankToValue[r1];
  const v2 = rankToValue[r2];

  if (!modifier) {
    // Pair
    return [
      { suit: suits[0], rank: r1, value: v1 },
      { suit: suits[1], rank: r2, value: v2 },
    ];
  } else if (modifier === 's') {
    // Suited
    return [
      { suit: suits[0], rank: r1, value: v1 },
      { suit: suits[0], rank: r2, value: v2 },
    ];
  } else {
    // Offsuit
    return [
      { suit: suits[0], rank: r1, value: v1 },
      { suit: suits[1], rank: r2, value: v2 },
    ];
  }
}

/**
 * Build the complete preflop lookup table
 * Returns: { "AKs": { 1: 0.67, 2: 0.51, ... 7: 0.28 }, ... }
 *
 * @param {number} simsPerEntry - MC simulations per table entry (default 10000)
 * @param {Function} onProgress - callback(completed, total) for progress reporting
 */
function buildPreflopTable(simsPerEntry = 10000, onProgress = null) {
  const handTypes = generate169HandTypes();
  const maxOpponents = 7;
  const totalEntries = handTypes.length * maxOpponents; // 169 × 7 = 1183
  let completed = 0;

  const table = {};

  for (const handType of handTypes) {
    table[handType] = {};
    const holeCards = getConcreteHand(handType);
    const knownSet = new Set(holeCards.map((c) => c.rank + c.suit));
    const remaining = createDeck().filter((c) => !knownSet.has(c.rank + c.suit));

    for (let numOpp = 1; numOpp <= maxOpponents; numOpp++) {
      let wins = 0,
        ties = 0;

      for (let sim = 0; sim < simsPerEntry; sim++) {
        const deck = shuffleFast(remaining);
        let idx = 0;

        // Deal 5 community cards
        const board = [deck[idx++], deck[idx++], deck[idx++], deck[idx++], deck[idx++]];
        const myHand = evaluateHand([...holeCards, ...board]);

        let isBest = true,
          isTied = false;
        for (let o = 0; o < numOpp; o++) {
          const oppHand = evaluateHand([deck[idx++], deck[idx++], ...board]);
          const cmp = compareHands(myHand, oppHand);
          if (cmp < 0) {
            isBest = false;
            break;
          }
          if (cmp === 0) isTied = true;
        }
        if (isBest && !isTied) wins++;
        else if (isBest && isTied) ties++;
      }

      table[handType][numOpp] = Math.round(((wins + ties * 0.5) / simsPerEntry) * 10000) / 10000;

      completed++;
      if (onProgress && completed % 50 === 0) {
        onProgress(completed, totalEntries);
      }
    }
  }

  if (onProgress) onProgress(totalEntries, totalEntries);
  return table;
}

function shuffleFast(arr) {
  const d = [...arr];
  for (let i = d.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = d[i];
    d[i] = d[j];
    d[j] = tmp;
  }
  return d;
}

/**
 * Look up preflop equity from the table
 *
 * @param {Object} table - The preflop lookup table
 * @param {Array} holeCards - Player's 2 cards
 * @param {number} numOpponents - Number of opponents
 * @returns {number} Equity (0-1), or null if table not ready
 */
function lookupPreflopEquity(table, holeCards, numOpponents) {
  if (!table) return null;
  const key = getHandKey(holeCards[0], holeCards[1]);
  const opp = Math.min(Math.max(numOpponents, 1), 7);
  if (table[key] && table[key][opp] !== undefined) {
    return table[key][opp];
  }
  return null;
}

module.exports = {
  buildPreflopTable,
  lookupPreflopEquity,
  getHandKey,
  generate169HandTypes,
  getConcreteHand,
};
