// strategy.js — Semi-professional strategy layer
// Adds: board texture, multi-street hand planning, SPR awareness, blocker effects
//
// This transforms NPC from "react to each street" to "have a plan for the whole hand"

// ============================================================
//  1. BOARD TEXTURE ANALYSIS
//  "Is this board wet or dry? Who does it favor?"
// ============================================================

function analyzeBoardTexture(communityCards) {
  if (!communityCards || communityCards.length === 0) {
    return {
      wetness: 0,
      paired: false,
      monotone: false,
      connected: false,
      highCards: 0,
      texture: 'none',
    };
  }

  const suits = communityCards.map((c) => c.suit);
  const values = communityCards.map((c) => c.value).sort((a, b) => a - b);

  // Flush draw potential
  const suitCounts = {};
  for (const s of suits) suitCounts[s] = (suitCounts[s] || 0) + 1;
  const maxSuitCount = Math.max(...Object.values(suitCounts));
  const monotone = maxSuitCount >= 3;
  const flushDrawPossible = maxSuitCount >= 2;

  // Straight draw potential
  let maxConnected = 1,
    currentRun = 1;
  const uniqueValues = [...new Set(values)];
  for (let i = 1; i < uniqueValues.length; i++) {
    if (uniqueValues[i] - uniqueValues[i - 1] <= 2) {
      currentRun++;
      maxConnected = Math.max(maxConnected, currentRun);
    } else {
      currentRun = 1;
    }
  }
  const connected = maxConnected >= 3;

  // Paired board
  const valueCounts = {};
  for (const v of values) valueCounts[v] = (valueCounts[v] || 0) + 1;
  const paired = Object.values(valueCounts).some((c) => c >= 2);
  const trips = Object.values(valueCounts).some((c) => c >= 3);

  // High card count (Broadway: T, J, Q, K, A)
  const highCards = values.filter((v) => v >= 10).length;

  // Overall wetness score (0 = bone dry, 1 = soaking wet)
  let wetness = 0;
  if (flushDrawPossible) wetness += 0.3;
  if (monotone) wetness += 0.2;
  if (connected) wetness += 0.3;
  if (maxConnected >= 4) wetness += 0.1;
  if (!paired) wetness += 0.1; // unpaired boards have more draw possibilities

  // Texture classification
  let texture;
  if (wetness > 0.6) texture = 'wet';
  else if (wetness > 0.3) texture = 'medium';
  else texture = 'dry';

  return {
    wetness: Math.min(1, wetness),
    paired,
    trips,
    monotone,
    connected,
    flushDrawPossible,
    highCards,
    maxSuitCount,
    texture,
    topCard: values[values.length - 1],
    bottomCard: values[0],
  };
}

// ============================================================
//  2. HAND-BOARD FIT
//  "How well does my hand connect with this board?"
// ============================================================

function analyzeHandBoardFit(holeCards, communityCards, boardTex) {
  if (!communityCards || communityCards.length === 0) return { fit: 'preflop', strength: 0.5 };

  const allCards = [...holeCards, ...communityCards];
  const holeValues = holeCards.map((c) => c.value);
  const holeSuits = holeCards.map((c) => c.suit);
  const boardValues = communityCards.map((c) => c.value);

  // Check for made hands
  const allValues = allCards.map((c) => c.value);
  const valueCounts = {};
  for (const v of allValues) valueCounts[v] = (valueCounts[v] || 0) + 1;
  const maxCount = Math.max(...Object.values(valueCounts));

  // Pair type detection
  let hasPair = false,
    hasOverpair = false,
    hasTopPair = false,
    hasSet = false;
  let hasTwoPair = false,
    pairCount = 0;

  for (const hv of holeValues) {
    if (boardValues.includes(hv)) {
      hasPair = true;
      if (hv === Math.max(...boardValues)) hasTopPair = true;
    }
    if (valueCounts[hv] >= 3 && holeValues.filter((v) => v === hv).length >= 1) hasSet = true;
    if (hv > Math.max(...boardValues)) hasOverpair = holeValues[0] === holeValues[1];
  }

  pairCount = Object.values(valueCounts).filter((c) => c >= 2).length;
  hasTwoPair = pairCount >= 2 && holeValues.some((v) => valueCounts[v] >= 2);

  // Draw detection
  let hasFlushDraw = false,
    hasStraightDraw = false,
    hasComboDraws = false;
  // Flush draw: 2 hole cards same suit, 2+ board cards same suit
  for (const suit of new Set(holeSuits)) {
    const holeSuitCount = holeSuits.filter((s) => s === suit).length;
    const boardSuitCount = communityCards.filter((c) => c.suit === suit).length;
    if (holeSuitCount >= 1 && holeSuitCount + boardSuitCount >= 4) hasFlushDraw = true;
  }

  // Straight draw (simplified: 4 to a straight)
  const allUnique = [...new Set(allValues)].sort((a, b) => a - b);
  for (let i = 0; i <= allUnique.length - 4; i++) {
    if (allUnique[i + 3] - allUnique[i] <= 4) {
      // Check if hole cards contribute
      const window = allUnique.slice(i, i + 4);
      if (holeValues.some((v) => window.includes(v))) hasStraightDraw = true;
    }
  }

  hasComboDraws = hasFlushDraw && hasStraightDraw;

  // Blocker detection
  let hasNutFlushBlocker = false;
  if (boardTex.flushDrawPossible) {
    // Find the dominant suit on board
    const suitCounts = {};
    for (const c of communityCards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
    const dominantSuit = Object.entries(suitCounts).sort((a, b) => b[1] - a[1])[0][0];
    // Do I have the Ace of that suit?
    hasNutFlushBlocker = holeCards.some((c) => c.suit === dominantSuit && c.value === 14);
  }

  // Classify fit
  let fit, strength;
  if (hasSet) {
    fit = 'set';
    strength = 0.9;
  } else if (hasTwoPair) {
    fit = 'two_pair';
    strength = 0.78;
  } else if (hasOverpair) {
    fit = 'overpair';
    strength = 0.75;
  } else if (hasTopPair && Math.max(...holeValues) >= 10) {
    fit = 'top_pair_good_kicker';
    strength = 0.68;
  } else if (hasTopPair) {
    fit = 'top_pair_weak_kicker';
    strength = 0.58;
  } else if (hasPair) {
    fit = 'middle_or_bottom_pair';
    strength = 0.42;
  } else if (hasComboDraws) {
    fit = 'combo_draw';
    strength = 0.55;
  } else if (hasFlushDraw) {
    fit = 'flush_draw';
    strength = 0.45;
  } else if (hasStraightDraw) {
    fit = 'straight_draw';
    strength = 0.4;
  } else if (Math.max(...holeValues) >= 14) {
    fit = 'overcards';
    strength = 0.3;
  } else {
    fit = 'air';
    strength = 0.15;
  }

  return {
    fit,
    strength,
    hasSet,
    hasTwoPair,
    hasOverpair,
    hasTopPair,
    hasPair,
    hasFlushDraw,
    hasStraightDraw,
    hasComboDraws,
    hasNutFlushBlocker,
  };
}

// ============================================================
//  3. HAND PLAN
//  "What is my plan for this entire hand?"
// ============================================================

function generateHandPlan(handFit, boardTex, equity, spr, position, isPreRaiser) {
  // SPR = effective stack / pot (after flop)
  // Low SPR (<4): committed, go with it
  // Medium SPR (4-10): standard play
  // High SPR (>10): deep stacked, careful

  const plan = {
    betStreets: 0, // how many streets to bet for value (0-3)
    betSizing: 'medium', // 'small', 'medium', 'large', 'overbet'
    canFoldToRaise: true, // true if hand is not strong enough to stack off
    shouldSlowplay: false,
    shouldCheckRaise: false,
    drawPlan: 'none', // 'none', 'passive_draw', 'aggressive_draw', 'semi_bluff'
    planType: 'default',
  };

  // ── Monster hands: set+, two pair on dry board ──
  if (handFit.hasSet || (handFit.hasTwoPair && boardTex.texture === 'dry')) {
    plan.planType = 'monster';
    plan.betStreets = 3;
    plan.canFoldToRaise = false;
    plan.betSizing = spr < 4 ? 'large' : 'medium';
    // Slowplay on very dry boards in position
    if (boardTex.texture === 'dry' && position === 'late' && Math.random() < 0.35) {
      plan.shouldSlowplay = true;
      plan.shouldCheckRaise = Math.random() < 0.4;
    }
    return plan;
  }

  // ── Strong hands: top pair good kicker, overpair ──
  if (handFit.fit === 'overpair' || handFit.fit === 'top_pair_good_kicker') {
    plan.planType = 'value';
    plan.canFoldToRaise = true; // Top pair is strong but foldable to huge re-raises
    if (boardTex.texture === 'wet') {
      plan.betStreets = 3;
      plan.betSizing = 'large';
    } else {
      plan.betStreets = 2;
      plan.betSizing = 'medium';
    }
    return plan;
  }

  // ── Medium hands: top pair weak kicker, middle pair ──
  if (handFit.fit === 'top_pair_weak_kicker' || handFit.fit === 'middle_or_bottom_pair') {
    plan.planType = 'thin_value';
    plan.betStreets = boardTex.texture === 'dry' ? 1 : 0; // one street max
    plan.betSizing = 'small';
    plan.canFoldToRaise = true;
    return plan;
  }

  // ── Draws ──
  if (handFit.hasComboDraws) {
    plan.planType = 'semi_bluff';
    plan.drawPlan = 'aggressive_draw';
    plan.betStreets = 2;
    plan.betSizing = 'large'; // semi-bluff big to fold out marginal hands
    plan.canFoldToRaise = spr > 6;
    return plan;
  }

  if (handFit.hasFlushDraw || handFit.hasStraightDraw) {
    plan.planType = 'draw';
    if (isPreRaiser && position !== 'early') {
      plan.drawPlan = 'semi_bluff';
      plan.betStreets = 1;
      plan.betSizing = 'medium';
    } else {
      plan.drawPlan = 'passive_draw';
      plan.betStreets = 0;
    }
    plan.canFoldToRaise = true;
    return plan;
  }

  // ── Air ──
  if (handFit.fit === 'air' || handFit.fit === 'overcards') {
    plan.planType = 'give_up';
    plan.betStreets = 0;
    plan.canFoldToRaise = true;
    // Unless we were the preflop raiser (c-bet opportunity handled elsewhere)
    if (isPreRaiser) {
      plan.planType = 'cbet_then_give_up';
      plan.betStreets = 1;
      plan.betSizing = 'small';
    }
    return plan;
  }

  return plan;
}

// ============================================================
//  4. SPR CALCULATOR
// ============================================================

function calculateSPR(chips, pot) {
  if (pot <= 0) return 100;
  return chips / pot;
}

// ============================================================
//  5. BET SIZING BY PLAN
// ============================================================

function getPlanBetSize(plan, pot, chips, boardTex, phase) {
  let sizePct;

  switch (plan.betSizing) {
    case 'small':
      sizePct = boardTex.texture === 'dry' ? 0.25 : 0.33;
      break;
    case 'medium':
      sizePct = boardTex.texture === 'wet' ? 0.6 : 0.5;
      break;
    case 'large':
      sizePct = boardTex.texture === 'wet' ? 0.8 : 0.67;
      break;
    case 'overbet':
      sizePct = 1.2;
      break;
    default:
      sizePct = 0.5;
  }

  // Later streets: size up (building pot toward target)
  if (phase === 'turn') sizePct *= 1.1;
  if (phase === 'river') sizePct *= 1.2;

  const size = Math.floor(pot * sizePct);
  return Math.min(size, chips);
}

// ============================================================
//  6. BLOCKER-BASED BLUFF SELECTION
//  "My hand blocks their strong range, making bluffs more effective"
// ============================================================

function blockerBluffValue(holeCards, communityCards, boardTex) {
  // Returns 0-1: how good this hand is as a bluff based on card removal
  let value = 0;

  if (boardTex.monotone || boardTex.flushDrawPossible) {
    // Having the ace of the dominant suit blocks nut flush
    const suitCounts = {};
    for (const c of communityCards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
    const dominantSuit = Object.entries(suitCounts).sort((a, b) => b[1] - a[1])[0][0];
    if (holeCards.some((c) => c.suit === dominantSuit && c.value === 14)) value += 0.35;
    if (holeCards.some((c) => c.suit === dominantSuit && c.value === 13)) value += 0.15;
  }

  if (boardTex.connected) {
    // Having cards that block straight completions
    const topCard = boardTex.topCard;
    if (holeCards.some((c) => c.value === topCard + 1 || c.value === topCard + 2)) value += 0.15;
  }

  // Having an ace blocks top pair on ace-high boards
  if (boardTex.topCard === 14 && holeCards.some((c) => c.value === 14)) value += 0.2;

  return Math.min(1, value);
}

// ============================================================
//  MAIN: Apply strategy to modify NPC decision context
// ============================================================

function generateStrategy(holeCards, communityCards, gameState) {
  const { pot, chips, phase } = gameState;
  const isPreRaiser = gameState._wasPreRaiser || false;
  const posName = gameState._positionName || 'middle';

  const boardTex = analyzeBoardTexture(communityCards);
  const handFit = analyzeHandBoardFit(holeCards, communityCards, boardTex);
  const spr = calculateSPR(chips, pot);

  // Only generate plan on flop (or use existing plan for later streets)
  const plan = generateHandPlan(handFit, boardTex, 0, spr, posName, isPreRaiser);
  const planBetSize = getPlanBetSize(plan, pot, chips, boardTex, phase);
  const blockerValue = blockerBluffValue(holeCards, communityCards, boardTex);

  // Determine how many streets have been bet (for plan tracking)
  const myActions = gameState._myHandActions || [];
  const streetsBet = new Set(
    myActions.filter((a) => a.action === 'raise' || a.action === 'allin').map((a) => a.phase)
  ).size;

  // Should we bet this street according to plan?
  const shouldBetThisStreet = streetsBet < plan.betStreets;

  return {
    boardTex,
    handFit,
    spr,
    plan,
    planBetSize,
    blockerValue,
    shouldBetThisStreet,
    streetsBet,
  };
}

module.exports = {
  analyzeBoardTexture,
  analyzeHandBoardFit,
  generateHandPlan,
  calculateSPR,
  getPlanBetSize,
  blockerBluffValue,
  generateStrategy,
};
