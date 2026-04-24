const tailOverrideConfig = require('./solver-tail-overrides.json');
const { canonicalizeBoard, cardCode } = require('./solver-board');
const RANK_VALUE = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

function normalizeFlopKey(board) {
  const flop = Array.isArray(board)
    ? board
    : String(board || '')
        .match(/([2-9TJQKA][shdc])/gi)
        ?.map((card) => card.trim());
  if (!flop || flop.length !== 3) return null;
  return canonicalizeBoard(flop).flop.map(cardCode).join('');
}

function getBoardFacts(board) {
  const key = normalizeFlopKey(board);
  if (!key) return null;
  const flop = key.match(/([2-9TJQKA][shdc])/gi);
  const values = flop.map((card) => RANK_VALUE[card[0].toUpperCase()]).sort((left, right) => left - right);
  const uniqueValues = [...new Set(values)];
  return {
    key,
    values,
    highest: values[values.length - 1],
    lowest: values[0],
    span: values[values.length - 1] - values[0],
    paired: uniqueValues.length < values.length,
    lowCards: values.filter((value) => value <= 8).length,
    highCards: values.filter((value) => value >= 10).length,
  };
}

function matchesCriteria(facts, criteria = {}) {
  if (criteria.paired !== undefined && facts.paired !== criteria.paired) return false;
  if (criteria.highestGte !== undefined && facts.highest < criteria.highestGte) return false;
  if (criteria.highestLte !== undefined && facts.highest > criteria.highestLte) return false;
  if (criteria.lowestGte !== undefined && facts.lowest < criteria.lowestGte) return false;
  if (criteria.lowestLte !== undefined && facts.lowest > criteria.lowestLte) return false;
  if (criteria.lowCardsGte !== undefined && facts.lowCards < criteria.lowCardsGte) return false;
  if (criteria.lowCardsLte !== undefined && facts.lowCards > criteria.lowCardsLte) return false;
  if (criteria.highCardsGte !== undefined && facts.highCards < criteria.highCardsGte) return false;
  if (criteria.highCardsLte !== undefined && facts.highCards > criteria.highCardsLte) return false;
  if (criteria.spanGte !== undefined && facts.span < criteria.spanGte) return false;
  if (criteria.spanLte !== undefined && facts.span > criteria.spanLte) return false;
  return true;
}

function resolveExactBoardOverride(board) {
  const key = normalizeFlopKey(board);
  if (!key) return null;
  const match = tailOverrideConfig.exactOverrides?.[key];
  if (!match) return null;
  return {
    key,
    profileSource: 'exact_override',
    ruleId: match.ruleId || `exact_${key}`,
    reason: match.reason || 'Exact phase-1 tail override.',
    targetProfile: match.targetProfile,
    excludeFromDataset: Boolean(match.excludeFromDataset),
  };
}

function resolvePatternBoardOverride(board) {
  const facts = getBoardFacts(board);
  if (!facts) return null;
  const rules = Array.isArray(tailOverrideConfig.patternOverrides)
    ? tailOverrideConfig.patternOverrides
    : [];
  for (const rule of rules) {
    if (!matchesCriteria(facts, rule.criteria)) continue;
    return {
      key: facts.key,
      profileSource: 'pattern_override',
      ruleId: rule.id,
      reason: rule.reason || 'Pattern phase-1 tail override.',
      targetProfile: rule.targetProfile,
      excludeFromDataset: Boolean(rule.excludeFromDataset),
      facts,
    };
  }
  return null;
}

function resolveTailOverride(board) {
  return resolveExactBoardOverride(board) || resolvePatternBoardOverride(board);
}

function getDatasetExcludedFlops() {
  return Object.entries(tailOverrideConfig.exactOverrides || {})
    .filter(([, value]) => value?.excludeFromDataset)
    .map(([flop]) => flop)
    .sort();
}

module.exports = {
  getBoardFacts,
  getDatasetExcludedFlops,
  normalizeFlopKey,
  resolveExactBoardOverride,
  resolvePatternBoardOverride,
  resolveTailOverride,
  tailOverrideConfig,
};
