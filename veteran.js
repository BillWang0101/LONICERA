// veteran.js — Veteran thinking layer
// Lightweight opponent modeling that mimics how human pros think
// NOT full Bayesian (1326 combos), but story-based reasoning
//
// Human pros think in 4 dimensions:
// 1. "What's his story?" — reading opponent action sequence
// 2. "Does his story make sense?" — detecting inconsistency
// 3. "What do I look like to him?" — self-image awareness
// 4. "What kind of player is he?" — dynamic exploit adjustment
//
// This module produces a "read" object that modifies NPC decisions.

// ============================================================
//  1. OPPONENT STORY READING
//  Track perceived opponent strength as actions unfold within a hand
// ============================================================

function readOpponentStory(opponentActions, phase, opponentStats) {
  // opponentActions: [{phase, action, amount}]
  // Returns: { perceivedStrength: 0-1, storyType: string, confidence: 0-1 }

  if (!opponentActions || opponentActions.length === 0) {
    return { perceivedStrength: 0.5, storyType: 'unknown', confidence: 0.1 };
  }

  let strength = 0.5; // prior
  let aggCount = 0;
  let passiveCount = 0;
  let lastAggPhase = null;

  for (const a of opponentActions) {
    switch (a.action) {
      case 'raise':
        strength += 0.15;
        aggCount++;
        lastAggPhase = a.phase;
        break;
      case 'allin':
        strength += 0.25;
        aggCount++;
        lastAggPhase = a.phase;
        break;
      case 'call':
        strength += 0.02; // calling shows some strength but not much
        passiveCount++;
        break;
      case 'check':
        strength -= 0.08; // weakness signal
        passiveCount++;
        break;
      case 'fold':
        strength = 0; // irrelevant, they're out
        break;
    }
  }

  strength = Math.max(0, Math.min(1, strength));

  // Adjust by opponent's known tendencies
  if (opponentStats) {
    // A known bluffer's aggression means less
    if (opponentStats.bluffFreq > 0.3) {
      strength *= 0.8; // discount strength signals from known bluffers
    }
    // A known rock's aggression means a LOT
    if (opponentStats.vpip < 0.25 && aggCount > 0) {
      strength = Math.min(1, strength * 1.3);
    }
  }

  // Classify the story
  let storyType = 'unknown';
  if (aggCount >= 2)
    storyType = 'strong_line'; // raise-raise = likely has it
  else if (aggCount === 1 && passiveCount >= 1)
    storyType = 'mixed_line'; // could be anything
  else if (passiveCount >= 2 && aggCount === 0)
    storyType = 'weak_line'; // check-check = weak
  else if (aggCount === 1) storyType = 'single_barrel'; // one bet, unclear

  // Confidence: more actions = more confident in read
  const confidence = Math.min(0.9, opponentActions.length * 0.15 + 0.1);

  return { perceivedStrength: strength, storyType, confidence };
}

// ============================================================
//  2. STORY CONSISTENCY DETECTION
//  "Does his line make sense? If not, maybe he's bluffing."
// ============================================================

function detectInconsistency(opponentActions) {
  if (!opponentActions || opponentActions.length < 2) return 0;

  let inconsistency = 0;

  // Pattern: raised preflop, then check-check = suspicious slowdown
  const preflopRaise = opponentActions.some(
    (a) => a.phase === 'preflop' && (a.action === 'raise' || a.action === 'allin')
  );
  const flopCheck = opponentActions.some((a) => a.phase === 'flop' && a.action === 'check');
  const turnBet = opponentActions.some(
    (a) => a.phase === 'turn' && (a.action === 'raise' || a.action === 'allin')
  );
  const flopBet = opponentActions.some(
    (a) => a.phase === 'flop' && (a.action === 'raise' || a.action === 'allin')
  );

  // "Gave up then came back" — suspicious
  if (preflopRaise && flopCheck && turnBet) {
    inconsistency += 0.35; // delayed c-bet or bluff
  }

  // "Bet small on flop, then bombs the turn" — polarizing, could be bluff
  const flopAmount = opponentActions.find((a) => a.phase === 'flop' && a.action === 'raise');
  const turnAmount = opponentActions.find((a) => a.phase === 'turn' && a.action === 'raise');
  if (flopAmount && turnAmount && turnAmount.amount > flopAmount.amount * 2.5) {
    inconsistency += 0.2; // sizing inconsistency
  }

  // "Check-raise" pattern (checked, then raised after our bet)
  // This is either very strong or a bluff — high uncertainty
  const phases = ['flop', 'turn', 'river'];
  for (const ph of phases) {
    const phActions = opponentActions.filter((a) => a.phase === ph);
    if (
      phActions.length >= 2 &&
      phActions[0].action === 'check' &&
      phActions[1].action === 'raise'
    ) {
      inconsistency += 0.15; // check-raise is polarized
    }
  }

  return Math.min(0.8, inconsistency);
}

// ============================================================
//  3. SELF-IMAGE AWARENESS
//  "How do I look to them? Am I credible?"
// ============================================================

function assessSelfImage(myRecentActions) {
  // myRecentActions: array of {action, phase} from recent hands
  if (!myRecentActions || myRecentActions.length === 0) {
    return { image: 'unknown', bluffCredibility: 0.5, valueCredibility: 0.5 };
  }

  let raiseCount = 0,
    foldCount = 0,
    totalActions = myRecentActions.length;
  for (const a of myRecentActions) {
    if (a.action === 'raise' || a.action === 'allin') raiseCount++;
    if (a.action === 'fold') foldCount++;
  }

  const aggFreq = raiseCount / totalActions;
  const foldFreq = foldCount / totalActions;

  let image, bluffCredibility, valueCredibility;

  if (aggFreq > 0.5) {
    // I've been playing loose-aggressive
    image = 'LAG';
    bluffCredibility = 0.3; // people won't believe my bluffs
    valueCredibility = 0.8; // but they'll call my value bets
  } else if (foldFreq > 0.6) {
    // I've been playing tight
    image = 'tight';
    bluffCredibility = 0.8; // people will fold to my bets
    valueCredibility = 0.4; // but they'll fold to my value too
  } else {
    image = 'balanced';
    bluffCredibility = 0.55;
    valueCredibility = 0.55;
  }

  return { image, bluffCredibility, valueCredibility };
}

// ============================================================
//  4. DYNAMIC EXPLOIT ADJUSTMENT
//  "This guy folds too much. Let me push him around."
// ============================================================

function calculateExploitAdjustment(opponentStats, sessionProfile) {
  // Returns adjustments to apply on top of sessionProfile
  const adj = { tightnessAdj: 0, bluffAdj: 0, aggressionAdj: 0, calldownAdj: 0 };

  if (!opponentStats || Object.keys(opponentStats).length === 0) return adj;

  // Aggregate opponent tendencies
  const stats = Object.values(opponentStats);
  if (stats.length === 0) return adj;

  const avgVpip = stats.reduce((s, p) => s + (p.vpip || 0.5), 0) / stats.length;
  const avgFoldToRaise = stats.reduce((s, p) => s + (p.foldToRaise || 0.5), 0) / stats.length;
  const avgAggression = stats.reduce((s, p) => s + (p.aggression || 0.5), 0) / stats.length;

  // If opponents fold too much → bluff more
  if (avgFoldToRaise > 0.6) {
    adj.bluffAdj = 0.15;
    adj.aggressionAdj = 0.1;
  }

  // If opponents call too much → stop bluffing, value bet thinner
  if (avgVpip > 0.6 && avgFoldToRaise < 0.3) {
    adj.bluffAdj = -0.15;
    adj.tightnessAdj = -0.1; // play more hands for value
  }

  // If opponents are very passive → steal more
  if (avgAggression < 0.3) {
    adj.aggressionAdj = 0.15;
  }

  // If opponents are very aggressive → trap more, call down wider
  if (avgAggression > 0.7) {
    adj.calldownAdj = 0.1; // lower fold threshold
    adj.aggressionAdj = -0.1; // less aggression, more trapping
  }

  return adj;
}

// ============================================================
//  5. BLUFF COMMITMENT
//  "I started this bluff, I should follow through."
// ============================================================

function shouldCommitToBluff(myHandActions, phase, chips, pot) {
  // If I bet the previous street(s) without a strong hand, I should
  // consider continuing the story rather than giving up
  if (!myHandActions || myHandActions.length === 0) return { commit: false };

  const prevStreetBets = myHandActions.filter(
    (a) => (a.action === 'raise' || a.action === 'allin') && a.phase !== phase
  );

  if (prevStreetBets.length === 0) return { commit: false };

  // I've invested in a bluff story. Probability of continuing:
  // Higher if pot is big relative to remaining bet (pot commitment)
  // Lower on later streets (river bluffs are expensive)
  const potCommitment = pot / (chips + pot);
  const streetPenalty = phase === 'river' ? 0.6 : phase === 'turn' ? 0.8 : 1.0;
  const commitProb = Math.min(0.7, potCommitment * streetPenalty * 0.8);

  return {
    commit: Math.random() < commitProb,
    suggestedSize: Math.floor(pot * (0.6 + Math.random() * 0.3)),
  };
}

// ============================================================
//  MAIN: Generate veteran "read" for use in npcDecision
// ============================================================

function generateVeteranRead(gameState, sessionProfile, phase) {
  const { opponentActions, opponentProfiles, pot, chips, _myHandActions } = gameState;

  // 1. Read each opponent's story
  const opponentReads = {};
  let strongestOpponent = 0;
  let mostSuspicious = 0;

  if (opponentActions) {
    for (const [oppId, actions] of Object.entries(opponentActions)) {
      const oppStats = opponentProfiles ? opponentProfiles[oppId] : null;
      const read = readOpponentStory(actions, phase, oppStats);
      const inconsistency = detectInconsistency(actions);
      opponentReads[oppId] = { ...read, inconsistency };
      strongestOpponent = Math.max(strongestOpponent, read.perceivedStrength);
      mostSuspicious = Math.max(mostSuspicious, inconsistency);
    }
  }

  // 2. Self-image (from gameState if available)
  const selfImage = assessSelfImage(gameState._myRecentActions || []);

  // 3. Exploit adjustment
  const exploitAdj = calculateExploitAdjustment(opponentProfiles, sessionProfile);

  // 4. Bluff commitment
  const bluffCommit = shouldCommitToBluff(_myHandActions || [], phase, chips, pot);

  return {
    opponentReads,
    strongestOpponentStrength: strongestOpponent,
    suspicionLevel: mostSuspicious, // 0-0.8: how likely opponent is bluffing
    selfImage,
    exploitAdj,
    bluffCommit,
  };
}

// ============================================================
//  Apply veteran read to modify equity-based decision
// ============================================================

function applyVeteranRead(read, effectiveEquity, toCall, pot, chips, minRaise, sessionProfile) {
  // Returns: { equityAdjustment, shouldBluffContinue, foldThresholdAdjust, betSizeMultiplier }

  let eqAdj = 0;
  let foldAdj = 0;
  let sizeMultiplier = 1.0;

  // If opponent's story is suspicious (inconsistent), we should call down wider
  if (read.suspicionLevel > 0.3) {
    eqAdj += read.suspicionLevel * 0.12; // play as if we're stronger
    foldAdj -= read.suspicionLevel * 0.15; // less likely to fold
  }

  // If opponent looks very strong and consistent, tighten up
  if (read.strongestOpponentStrength > 0.7 && read.suspicionLevel < 0.2) {
    eqAdj -= 0.05;
    foldAdj += 0.08;
  }

  // If our image is tight, bluffs are more credible → size them bigger
  if (read.selfImage.bluffCredibility > 0.6) {
    sizeMultiplier *= 1.15;
  }
  // If our image is LAG, value bets get called more → bet bigger for value
  if (read.selfImage.valueCredibility > 0.6) {
    sizeMultiplier *= 1.1;
  }

  // Exploit adjustments
  eqAdj += read.exploitAdj.calldownAdj || 0;
  foldAdj -= (read.exploitAdj.bluffAdj || 0) * 0.5;

  // Bluff continuation
  const shouldBluffContinue = read.bluffCommit.commit;
  const bluffContinueSize = read.bluffCommit.suggestedSize || 0;

  return {
    equityAdjustment: eqAdj,
    foldThresholdAdjust: foldAdj,
    betSizeMultiplier: sizeMultiplier,
    shouldBluffContinue,
    bluffContinueSize,
  };
}

module.exports = {
  readOpponentStory,
  detectInconsistency,
  assessSelfImage,
  calculateExploitAdjustment,
  shouldCommitToBluff,
  generateVeteranRead,
  applyVeteranRead,
};
