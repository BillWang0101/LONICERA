const { analyzeBoardTexture, analyzeHandBoardFit, calculateSPR, blockerBluffValue } = require('./strategy');
const { scoreFlopDifficulty } = require('./solver-script-generator');
const { cardCode } = require('./solver-board');
const { listLegalActionsForGameState } = require('./solver-translate');

const SUPPORTED_MODEL_COVERAGE = {
  positionPair: 'BTN_vs_BB',
  preflopLine: 'SRP',
  effectiveBb: 50,
  phase: 'flop',
  actionLine: 'root',
};

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function cardBucket(card) {
  if (!card) return 'none';
  if (card.value >= 13) return 'broadway_top';
  if (card.value >= 10) return 'broadway_low';
  if (card.value >= 7) return 'middle';
  return 'low';
}

function buildHandFeatures(holeCards = [], communityCards = [], boardTex = null) {
  const handFit = analyzeHandBoardFit(holeCards, communityCards, boardTex || analyzeBoardTexture(communityCards));
  return {
    fit: handFit.fit,
    strength: handFit.strength,
    hasSet: handFit.hasSet,
    hasTwoPair: handFit.hasTwoPair,
    hasOverpair: handFit.hasOverpair,
    hasTopPair: handFit.hasTopPair,
    hasPair: handFit.hasPair,
    hasFlushDraw: handFit.hasFlushDraw,
    hasStraightDraw: handFit.hasStraightDraw,
    hasComboDraws: handFit.hasComboDraws,
    hasNutFlushBlocker: handFit.hasNutFlushBlocker,
  };
}

function describeBlockerClass(holeCards = [], communityCards = [], boardTex = null) {
  const blockerValue = blockerBluffValue(holeCards, communityCards, boardTex || analyzeBoardTexture(communityCards));
  if (blockerValue >= 0.35) return 'strong';
  if (blockerValue >= 0.18) return 'medium';
  if (blockerValue > 0) return 'light';
  return 'none';
}

function isModelSpotSupported(gameState) {
  const solverContext = gameState?.solverContext;
  if (!solverContext?.supported) {
    return { supported: false, reason: solverContext?.reason || 'unsupported_context' };
  }
  if (solverContext.positionPair !== SUPPORTED_MODEL_COVERAGE.positionPair) {
    return { supported: false, reason: 'unsupported_position_pair' };
  }
  if (solverContext.preflopLine !== SUPPORTED_MODEL_COVERAGE.preflopLine) {
    return { supported: false, reason: 'unsupported_preflop_line' };
  }
  if (Math.round(solverContext.effectiveBB || 0) !== SUPPORTED_MODEL_COVERAGE.effectiveBb) {
    return { supported: false, reason: 'unsupported_effective_bb' };
  }
  if (gameState.phase !== SUPPORTED_MODEL_COVERAGE.phase) {
    return { supported: false, reason: 'unsupported_phase' };
  }
  if ((gameState.communityCards || gameState.board || []).length !== 3) {
    return { supported: false, reason: 'unsupported_board_depth' };
  }
  if ((solverContext.actionLine || 'root') !== SUPPORTED_MODEL_COVERAGE.actionLine) {
    return { supported: false, reason: 'unsupported_action_line' };
  }
  return { supported: true, reason: 'covered_spot' };
}

function buildModelRequest({
  profile,
  holeCards,
  communityCards,
  gameState,
  solverAvailable = false,
}) {
  const boardTex = analyzeBoardTexture(communityCards);
  const handFeatures = buildHandFeatures(holeCards, communityCards, boardTex);
  const difficulty = scoreFlopDifficulty(communityCards);
  const support = isModelSpotSupported({
    ...gameState,
    communityCards,
  });
  const legalActions = listLegalActionsForGameState(gameState);
  const stackBb = (gameState.chips || 0) / Math.max(1, gameState.bigBlind || 20);
  const spr = calculateSPR(gameState.chips || 0, gameState.pot || 0);
  const initiative = gameState._wasPreRaiser ? 'aggressor' : 'defender';

  return {
    spotKey: `${gameState?.solverContext?.positionPair || 'unknown'}:${gameState?.solverContext?.preflopLine || 'unknown'}:${Math.round(gameState?.solverContext?.effectiveBB || stackBb)}:${gameState.phase}:${gameState?.solverContext?.actionLine || 'root'}`,
    positionPair: gameState?.solverContext?.positionPair || null,
    preflopLine: gameState?.solverContext?.preflopLine || null,
    effectiveBb: gameState?.solverContext?.effectiveBB || stackBb,
    phase: gameState.phase,
    actionLine: gameState?.solverContext?.actionLine || 'root',
    board: (communityCards || []).map(cardCode),
    holeCards: (holeCards || []).map(cardCode),
    pot: gameState.pot || 0,
    toCall: Math.max(0, (gameState.currentBet || 0) - (gameState.playerBet || 0)),
    minRaiseTo: gameState.minRaise || gameState.currentBet || 0,
    stack: gameState.chips || 0,
    activePlayers: gameState.activePlayers || 0,
    solverAvailable: !!solverAvailable,
    difficultyScore: difficulty.score,
    difficultyBand: difficulty.score <= 29 ? 'easy' : difficulty.score <= 59 ? 'medium' : 'hard',
    abstraction: {
      boardTexture: {
        texture: boardTex.texture,
        wetness: boardTex.wetness,
        paired: boardTex.paired,
        monotone: boardTex.monotone,
        connected: boardTex.connected,
        highCards: boardTex.highCards,
        topCardBucket: cardBucket({ value: boardTex.topCard }),
      },
      handFeatures,
      spr,
      blockerClass: describeBlockerClass(holeCards, communityCards, boardTex),
      initiative,
      position: gameState?.solverContext?.heroRole || null,
    },
    persona: {
      name: profile?.name || null,
      style: profile?.style || 'balanced',
      aggression: clamp01(profile?.aggression || 0.5),
      bluffFreq: clamp01(profile?.bluffFreq || 0.2),
    },
    legalActions,
    coverage: support,
  };
}

module.exports = {
  SUPPORTED_MODEL_COVERAGE,
  buildHandFeatures,
  buildModelRequest,
  describeBlockerClass,
  isModelSpotSupported,
};
