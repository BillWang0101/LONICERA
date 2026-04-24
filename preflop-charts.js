// preflop-charts.js — Position-based starting hand ranges + river polarization
//
// Preflop charts: standardized open/call/3bet ranges by position
// River polarization: GTO-inspired value/bluff ratio for final street

// ============================================================
//  1. PREFLOP HAND CLASSIFICATION
// ============================================================

function classifyHand(holeCards) {
  const [c1, c2] = holeCards;
  const high = Math.max(c1.value, c2.value);
  const low = Math.min(c1.value, c2.value);
  const suited = c1.suit === c2.suit;
  const pair = c1.value === c2.value;

  // Convert to standard notation: "AKs", "QTo", "88"
  const R = (v) => ({ 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' })[v] || String(v);
  let key;
  if (pair) key = R(high) + R(low);
  else key = R(high) + R(low) + (suited ? 's' : 'o');

  return { key, high, low, suited, pair, gap: high - low };
}

// ============================================================
//  2. POSITION-BASED OPENING RANGES
//  Based on standard 6-max cash game charts (GTO-simplified)
//  Returns a tier 1-8 (1 = premium, 8 = trash)
// ============================================================

// Hand strength tiers (position-independent base)
const HAND_TIERS = {};

// Tier 1: Premium (always open from any position)
['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo'].forEach((h) => (HAND_TIERS[h] = 1));

// Tier 2: Strong (open from EP+)
['TT', '99', 'AQs', 'AQo', 'AJs', 'KQs'].forEach((h) => (HAND_TIERS[h] = 2));

// Tier 3: Good (open from MP+)
['88', '77', 'ATs', 'AJo', 'KJs', 'KQo', 'QJs', 'ATo'].forEach((h) => (HAND_TIERS[h] = 3));

// Tier 4: Playable (open from CO+)
['66', '55', 'A9s', 'A8s', 'KTs', 'QTs', 'JTs', 'KJo', 'QJo', 'A9o'].forEach(
  (h) => (HAND_TIERS[h] = 4)
);

// Tier 5: Speculative (open from BTN/SB)
[
  '44',
  '33',
  '22',
  'A7s',
  'A6s',
  'A5s',
  'A4s',
  'A3s',
  'A2s',
  'K9s',
  'K8s',
  'Q9s',
  'J9s',
  'T9s',
  '98s',
  '87s',
  '76s',
  'A8o',
  'A7o',
  'KTo',
  'QTo',
  'JTo',
].forEach((h) => (HAND_TIERS[h] = 5));

// Tier 6: Wide (BTN steal / SB complete)
[
  'K7s',
  'K6s',
  'K5s',
  'K4s',
  'K3s',
  'K2s',
  'Q8s',
  'J8s',
  'T8s',
  '97s',
  '86s',
  '75s',
  '65s',
  '54s',
  'A6o',
  'A5o',
  'A4o',
  'A3o',
  'A2o',
  'K9o',
  'Q9o',
  'J9o',
  'T9o',
].forEach((h) => (HAND_TIERS[h] = 6));

// Tier 7: Junk (only play if very loose or blind defense)
[
  'Q7s',
  'Q6s',
  'Q5s',
  'Q4s',
  'Q3s',
  'Q2s',
  'J7s',
  'T7s',
  '96s',
  '85s',
  '74s',
  '64s',
  '53s',
  '43s',
  'K8o',
  'K7o',
  'K6o',
  'Q8o',
  'J8o',
  'T8o',
  '98o',
  '87o',
].forEach((h) => (HAND_TIERS[h] = 7));

// Everything else: Tier 8 (trash)

function getHandTier(holeCards) {
  const { key } = classifyHand(holeCards);
  return HAND_TIERS[key] || 8;
}

// Position-based maximum tier to open (lower = tighter)
// EP = early position, MP = middle, CO = cutoff, BTN = button, SB = small blind
const POSITION_OPEN_RANGE = {
  early: 3, // Only tiers 1-3
  middle: 4, // Tiers 1-4
  late: 5, // Tiers 1-5
  dealer: 6, // Tiers 1-6 (BTN steal)
  blind: 5, // SB/BB defense: 1-5
};

// Facing a raise: tighten by ~2 tiers
const POSITION_CALL_RAISE = {
  early: 2,
  middle: 2,
  late: 3,
  dealer: 4,
  blind: 3,
};

// Facing a 3-bet: only premiums
const CALL_3BET_MAX_TIER = 2;

// ============================================================
//  3. PREFLOP DECISION WITH CHARTS
// ============================================================

function chartBasedPreflopDecision(holeCards, position, scenario, tightnessAdj) {
  // scenario: 'open' (first to act), 'facing_raise', 'facing_3bet'
  // tightnessAdj: -2 to +2 (negative = looser, positive = tighter)
  // Returns: { action: 'open'|'call'|'3bet'|'fold', tier: number }

  const tier = getHandTier(holeCards);
  const adj = Math.round(tightnessAdj || 0);

  let maxTier;
  switch (scenario) {
    case 'facing_3bet':
      maxTier = CALL_3BET_MAX_TIER + adj;
      break;
    case 'facing_raise':
      maxTier = (POSITION_CALL_RAISE[position] || 3) + adj;
      break;
    case 'open':
    default:
      maxTier = (POSITION_OPEN_RANGE[position] || 4) + adj;
      break;
  }

  maxTier = Math.max(1, Math.min(8, maxTier));

  if (tier > maxTier) {
    return { action: 'fold', tier, maxTier };
  }

  // Determine action type
  if (scenario === 'open') {
    if (tier <= 2) return { action: '3bet', tier, maxTier }; // Premium: raise big
    return { action: 'open', tier, maxTier };
  }

  if (scenario === 'facing_raise') {
    if (tier <= 1) return { action: '3bet', tier, maxTier }; // Re-raise with premiums
    return { action: 'call', tier, maxTier };
  }

  if (scenario === 'facing_3bet') {
    if (tier <= 1) return { action: '4bet', tier, maxTier }; // AA/KK always 4-bet
    return { action: 'call', tier, maxTier };
  }

  return { action: 'call', tier, maxTier };
}

// ============================================================
//  4. RIVER POLARIZATION
//  On the river, optimal strategy is polarized:
//  - Bet with very strong hands (value) and very weak hands (bluffs)
//  - Check medium-strength hands (showdown value)
//  The value:bluff ratio should be ~2:1 for a pot-sized bet
// ============================================================

function riverPolarizedDecision(equity, pot, chips, toCall, minRaise, boardTex, sessionProfile) {
  // Returns: { shouldBet, betSize, isBluff, isValue, shouldCall }

  const result = {
    shouldBet: false,
    betSize: 0,
    isBluff: false,
    isValue: false,
    shouldCall: false,
    shouldFold: false,
  };

  // ── NOT facing a bet ──
  if (toCall === 0) {
    // Value range: equity > 0.7 (strong hands)
    if (equity > 0.7) {
      result.shouldBet = true;
      result.isValue = true;
      // Size: larger on wet boards (more hands to get value from)
      const sizePct = boardTex.texture === 'wet' ? 0.75 : 0.6;
      result.betSize = Math.max(minRaise, Math.floor(pot * sizePct));
      return result;
    }

    // Showdown value: equity 0.4-0.7 (medium hands — check!)
    if (equity > 0.4) {
      result.shouldBet = false; // Don't bet, just check and showdown
      return result;
    }

    // Bluff candidates: equity < 0.4
    // Optimal bluff frequency: betSize / (pot + betSize + betSize) for indifference
    // For 2/3 pot bet: bluff freq = 0.667pot / (pot + 0.667pot + 0.667pot) ≈ 28%
    // For pot bet: bluff freq = 1 / 3 ≈ 33%
    // We adjust by personality (aggressive players bluff more)
    const baseBluffFreq = 0.28;
    const personalBluffFreq = baseBluffFreq * (0.5 + sessionProfile.bluffFreq * 1.5);
    const adjustedFreq = Math.min(0.45, personalBluffFreq);

    if (Math.random() < adjustedFreq) {
      result.shouldBet = true;
      result.isBluff = true;
      // Bluff same size as value bet (opponent can't distinguish)
      const sizePct = boardTex.texture === 'wet' ? 0.75 : 0.6;
      result.betSize = Math.max(minRaise, Math.floor(pot * sizePct));
      return result;
    }

    // Give up with air
    result.shouldBet = false;
    return result;
  }

  // ── FACING a bet ──
  // Pot odds calculation for calling
  const potOdds = toCall / (pot + toCall);

  // Strong hands: raise for value
  if (equity > 0.8) {
    result.shouldBet = true;
    result.isValue = true;
    result.betSize = Math.max(minRaise, Math.floor((pot + toCall) * 0.8));
    return result;
  }

  // Medium hands: call if price is right (bluff catcher)
  if (equity > 0.4) {
    // Against a pot-sized bet, we need ~33% equity to call
    // Against a 2/3 pot bet, we need ~28% equity
    // We're using equity > 0.4, which is always enough
    result.shouldCall = true;
    return result;
  }

  // Weak hands: usually fold, but occasionally bluff-raise
  if (equity < 0.2) {
    // Bluff raise on river (very rare, very scary)
    const bluffRaiseFreq = sessionProfile.bluffFreq * 0.15; // Very low frequency
    if (Math.random() < bluffRaiseFreq && chips > toCall * 3) {
      result.shouldBet = true;
      result.isBluff = true;
      result.betSize = Math.max(minRaise, Math.floor((pot + toCall) * 1.0)); // Overbet bluff
      return result;
    }
  }

  // Marginal: call if pot odds are good
  if (equity > potOdds * 0.85) {
    result.shouldCall = true;
    return result;
  }

  result.shouldFold = true;
  return result;
}

module.exports = {
  classifyHand,
  getHandTier,
  chartBasedPreflopDecision,
  riverPolarizedDecision,
  HAND_TIERS,
};
