// range.js - Opponent Hand Range Estimation
// Estimates what hands an opponent likely holds based on their actions and tendencies
const { createDeck } = require('./deck');

/**
 * Generate all possible 2-card combinations from remaining cards
 */
function generateAllHands(excludeCards) {
  const excluded = new Set(excludeCards.map((c) => c.rank + c.suit));
  const remaining = createDeck().filter((c) => !excluded.has(c.rank + c.suit));
  const hands = [];
  for (let i = 0; i < remaining.length; i++) {
    for (let j = i + 1; j < remaining.length; j++) {
      hands.push([remaining[i], remaining[j]]);
    }
  }
  return hands;
}

/**
 * Calculate preflop hand strength (same as NPC uses)
 */
function preflopStrength(cards) {
  const [c1, c2] = cards;
  const isPair = c1.value === c2.value;
  const isSuited = c1.suit === c2.suit;
  const high = Math.max(c1.value, c2.value);
  const low = Math.min(c1.value, c2.value);
  let s = isPair ? 0.5 + (c1.value / 14) * 0.5 : (high + low) / 28;
  if (!isPair && isSuited) s += 0.06;
  if (!isPair && high - low <= 2) s += 0.04;
  if (!isPair && high - low <= 1) s += 0.03;
  if (!isPair && high >= 12) s += 0.08;
  if (!isPair && high === 14) s += 0.05;
  return Math.min(1, Math.max(0, s));
}

/**
 * Check how well a hand connects with the board
 */
function boardConnectivity(hand, board) {
  if (board.length === 0) return 0;

  const allCards = [...hand, ...board];
  let connectivity = 0;

  // Top pair or better
  const boardValues = board.map((c) => c.value);
  const maxBoardVal = Math.max(...boardValues);
  const handValues = hand.map((c) => c.value);

  // Pair with board
  for (const hv of handValues) {
    if (boardValues.includes(hv)) {
      connectivity += hv === maxBoardVal ? 0.4 : 0.2; // Top pair vs lower pair
    }
  }

  // Overpair
  if (hand[0].value === hand[1].value && hand[0].value > maxBoardVal) {
    connectivity += 0.45;
  }

  // Flush draw / made flush
  const suitCounts = {};
  for (const c of allCards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  const maxSuit = Math.max(...Object.values(suitCounts));
  if (maxSuit >= 5) connectivity += 0.5;
  else if (maxSuit === 4) connectivity += 0.15;

  // Straight potential
  const uniqueVals = [...new Set(allCards.map((c) => c.value))].sort((a, b) => a - b);
  for (let i = 0; i <= uniqueVals.length - 4; i++) {
    if (uniqueVals[i + 3] - uniqueVals[i] <= 4) {
      connectivity += 0.1;
      break;
    }
  }

  // Two pair or better
  const valCounts = {};
  for (const c of allCards) valCounts[c.value] = (valCounts[c.value] || 0) + 1;
  const pairs = Object.values(valCounts).filter((v) => v >= 2).length;
  if (pairs >= 2) connectivity += 0.3;
  const trips = Object.values(valCounts).filter((v) => v >= 3).length;
  if (trips >= 1) connectivity += 0.5;

  return Math.min(1, connectivity);
}

/**
 * Estimate opponent's hand range based on their actions and profile
 *
 * Returns an array of {hand, weight} where weight indicates
 * how likely the opponent holds that hand (0-1)
 *
 * @param {Array} excludeCards - Cards that can't be in opponent's hand
 * @param {Object} opponentProfile - From PlayerStats.getProfile()
 * @param {Array} actions - Opponent's actions this hand [{phase, action, amount}]
 * @param {Array} communityCards - Current community cards
 * @param {Object} context - {pot, bigBlind}
 * @returns {Array<{hand: Array, weight: number}>}
 */
function estimateRange(excludeCards, opponentProfile, actions, communityCards, context) {
  const allHands = generateAllHands(excludeCards);
  const bigBlind = context.bigBlind || 20;
  const confidence = opponentProfile ? opponentProfile.confidence : 0;

  // Start with all hands equally weighted
  let weightedHands = allHands.map((hand) => ({
    hand,
    weight: 1.0,
    strength: preflopStrength(hand),
  }));

  // === Phase 1: Preflop range narrowing ===
  const preflopActions = actions.filter((a) => a.phase === 'preflop');

  for (const action of preflopActions) {
    if (action.action === 'raise' || action.action === 'allin') {
      // Raiser's range: tighter than average
      // Use opponent's PFR if we have data, otherwise assume ~20%
      const estimatedPFR = confidence > 0.3 ? opponentProfile.pfr : 0.22;
      const raiseThreshold = 1 - estimatedPFR; // Top X% of hands

      weightedHands = weightedHands.map((wh) => {
        if (wh.strength >= raiseThreshold) {
          return { ...wh, weight: wh.weight * 1.0 }; // Keep full weight
        } else if (wh.strength >= raiseThreshold - 0.15) {
          return { ...wh, weight: wh.weight * 0.3 }; // Sometimes raises lighter
        } else {
          return { ...wh, weight: wh.weight * 0.05 }; // Rarely raises garbage
        }
      });

      // If it's a 3-bet (re-raise), tighten even more
      if (action.is3Bet) {
        const threeBetRange = confidence > 0.3 ? opponentProfile.threeBet : 0.07;
        const threeBetThreshold = 1 - threeBetRange;
        weightedHands = weightedHands.map((wh) => {
          if (wh.strength >= threeBetThreshold) {
            return { ...wh, weight: wh.weight * 1.0 };
          } else {
            return { ...wh, weight: wh.weight * 0.1 };
          }
        });
      }
    } else if (action.action === 'call') {
      // Caller's range: medium hands (not strong enough to raise, not weak enough to fold)
      const vpip = confidence > 0.3 ? opponentProfile.vpip : 0.3;
      const pfr = confidence > 0.3 ? opponentProfile.pfr : 0.2;
      // Calling range = VPIP - PFR (hands good enough to play but not raise)
      const callFloor = 1 - vpip;
      const raiseFloor = 1 - pfr;

      weightedHands = weightedHands.map((wh) => {
        if (wh.strength >= raiseFloor) {
          return { ...wh, weight: wh.weight * 0.4 }; // Sometimes slow-plays
        } else if (wh.strength >= callFloor) {
          return { ...wh, weight: wh.weight * 1.0 }; // Primary calling range
        } else if (wh.strength >= callFloor - 0.1) {
          return { ...wh, weight: wh.weight * 0.3 }; // Loose calls
        } else {
          return { ...wh, weight: wh.weight * 0.05 }; // Very unlikely
        }
      });
    } else if (action.action === 'check') {
      // Checked (from BB): wide range, but capped (no premium hands)
      weightedHands = weightedHands.map((wh) => {
        if (wh.strength > 0.85) {
          return { ...wh, weight: wh.weight * 0.2 }; // Would usually raise premium
        }
        return wh; // Everything else possible
      });
    }
  }

  // === Phase 2: Postflop range narrowing ===
  if (communityCards.length >= 3) {
    const postflopActions = actions.filter((a) => a.phase !== 'preflop');

    for (const action of postflopActions) {
      if (action.action === 'raise' || action.action === 'allin') {
        // Betting/raising postflop: hand likely connects with board
        const aggFactor = confidence > 0.3 ? opponentProfile.aggression : 1.5;

        weightedHands = weightedHands.map((wh) => {
          const conn = boardConnectivity(wh.hand, communityCards);

          if (conn > 0.4) {
            // Strong connection: definitely in range
            return { ...wh, weight: wh.weight * 1.0 };
          } else if (conn > 0.15) {
            // Moderate connection (draws, weak pairs)
            return { ...wh, weight: wh.weight * 0.6 };
          } else {
            // No connection: only if opponent is very aggressive (bluffing)
            const bluffWeight = aggFactor > 2 ? 0.25 : aggFactor > 1.5 ? 0.15 : 0.05;
            return { ...wh, weight: wh.weight * bluffWeight };
          }
        });
      } else if (action.action === 'call') {
        // Calling postflop: draws, medium pairs, some slow-plays
        weightedHands = weightedHands.map((wh) => {
          const conn = boardConnectivity(wh.hand, communityCards);

          if (conn > 0.3) {
            return { ...wh, weight: wh.weight * 1.0 }; // Good connection
          } else if (conn > 0.1) {
            return { ...wh, weight: wh.weight * 0.7 }; // Marginal (draws)
          } else {
            // Calling station might call with nothing
            const isStation = confidence > 0.3 && opponentProfile.playerType === 'calling_station';
            return { ...wh, weight: wh.weight * (isStation ? 0.4 : 0.1) };
          }
        });
      } else if (action.action === 'check') {
        // Checking postflop: usually weak, but could be trapping
        weightedHands = weightedHands.map((wh) => {
          const conn = boardConnectivity(wh.hand, communityCards);

          if (conn > 0.5) {
            // Very strong: sometimes traps, but usually bets
            return { ...wh, weight: wh.weight * 0.3 };
          }
          // Everything else: full weight (weak hands check)
          return wh;
        });
      } else if (action.action === 'fold') {
        // Folded: remove from range entirely (they're out)
        return [];
      }
    }
  }

  // === Phase 3: Normalize weights ===
  // Remove hands with negligible weight
  weightedHands = weightedHands.filter((wh) => wh.weight > 0.01);

  // Normalize to sum to 1
  const totalWeight = weightedHands.reduce((sum, wh) => sum + wh.weight, 0);
  if (totalWeight > 0) {
    weightedHands = weightedHands.map((wh) => ({
      ...wh,
      weight: wh.weight / totalWeight,
    }));
  }

  return weightedHands;
}

/**
 * Sample a hand from a weighted range (for Monte Carlo simulation)
 */
function sampleFromRange(weightedRange) {
  if (weightedRange.length === 0) return null;

  const r = Math.random();
  let cumulative = 0;
  for (const wh of weightedRange) {
    cumulative += wh.weight;
    if (r <= cumulative) return wh.hand;
  }
  return weightedRange[weightedRange.length - 1].hand;
}

module.exports = {
  estimateRange,
  sampleFromRange,
  generateAllHands,
  preflopStrength,
  boardConnectivity,
};
