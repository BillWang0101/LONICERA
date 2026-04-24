function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseActionKey(actionKey) {
  if (!actionKey) return null;
  const normalized = String(actionKey).trim().toLowerCase();
  if (normalized === 'check' || normalized === 'call' || normalized === 'fold' || normalized === 'allin') {
    return { type: normalized };
  }

  let match = normalized.match(/^bet[_ ](\d+(?:\.\d+)?)$/);
  if (match) return { type: 'bet', size: parseFloat(match[1]) };

  match = normalized.match(/^raise[_ ](\d+(?:\.\d+)?)$/);
  if (match) return { type: 'raise', size: parseFloat(match[1]) };

  match = normalized.match(/^bet\s+(\d+(?:\.\d+)?)$/);
  if (match) return { type: 'bet', size: parseFloat(match[1]) };

  match = normalized.match(/^raise\s+(\d+(?:\.\d+)?)$/);
  if (match) return { type: 'raise', size: parseFloat(match[1]) };

  return null;
}

function normalizeStrategyForGameState(strategy, gameState) {
  if (!strategy || typeof strategy !== 'object') return null;
  const toCall = Math.max(0, (gameState.currentBet || 0) - (gameState.playerBet || 0));
  const filtered = {};

  for (const [action, weight] of Object.entries(strategy)) {
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) continue;
    const parsed = parseActionKey(action);
    if (!parsed) continue;

    if (toCall === 0) {
      if (parsed.type === 'call' || parsed.type === 'fold' || parsed.type === 'raise') continue;
    } else if (parsed.type === 'check' || parsed.type === 'bet') {
      continue;
    }

    filtered[action] = weight;
  }

  const total = Object.values(filtered).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  return Object.fromEntries(Object.entries(filtered).map(([action, value]) => [action, value / total]));
}

function isActionLegalForGameState(actionKey, gameState) {
  return !!normalizeStrategyForGameState({ [actionKey]: 1 }, gameState);
}

function listLegalActionsForGameState(gameState, actionUniverse = []) {
  const defaultUniverse = [
    'fold',
    'check',
    'call',
    'bet_33',
    'bet_75',
    'bet_130',
    'raise_250',
    'raise_400',
    'allin',
  ];
  const universe =
    Array.isArray(actionUniverse) && actionUniverse.length > 0 ? actionUniverse : defaultUniverse;
  return universe.filter((action) => isActionLegalForGameState(action, gameState));
}

function pickAction(strategy, rng = Math.random) {
  const entries = Object.entries(strategy || {});
  if (entries.length === 0) return null;

  const roll = rng();
  let cumulative = 0;
  for (const [action, weight] of entries) {
    cumulative += weight;
    if (roll <= cumulative) return action;
  }
  return entries[entries.length - 1][0];
}

function translateChosenAction(actionKey, gameState) {
  const parsed = parseActionKey(actionKey);
  if (!parsed) return null;

  const pot = Math.max(1, gameState.pot || 0);
  const currentBet = gameState.currentBet || 0;
  const playerBet = gameState.playerBet || 0;
  const chips = gameState.chips || 0;
  const minRaiseTotal = gameState.minRaise || currentBet;
  const maxTotal = playerBet + chips;

  switch (parsed.type) {
    case 'check':
      return currentBet > playerBet ? null : { action: 'check' };
    case 'call':
      return currentBet > playerBet ? { action: 'call' } : { action: 'check' };
    case 'fold':
      return currentBet > playerBet ? { action: 'fold' } : { action: 'check' };
    case 'allin':
      return chips > 0 ? { action: 'allin' } : null;
    case 'bet': {
      if (currentBet > playerBet) return null;
      const target = Math.floor((pot * parsed.size) / 100);
      const total = clamp(Math.max(minRaiseTotal, target), minRaiseTotal, maxTotal);
      if (total >= maxTotal) return chips > 0 ? { action: 'allin' } : null;
      return total > playerBet ? { action: 'raise', amount: total } : { action: 'check' };
    }
    case 'raise': {
      if (currentBet <= playerBet) return null;
      const target = Math.floor((currentBet * parsed.size) / 100);
      if (maxTotal < minRaiseTotal) return chips > 0 ? { action: 'allin' } : { action: 'call' };
      const total = clamp(Math.max(minRaiseTotal, target), minRaiseTotal, maxTotal);
      if (total >= maxTotal) return chips > 0 ? { action: 'allin' } : { action: 'call' };
      return total > currentBet ? { action: 'raise', amount: total } : { action: 'call' };
    }
    default:
      return null;
  }
}

function solverDecisionFromStrategy(strategy, gameState, rng = Math.random) {
  const normalized = normalizeStrategyForGameState(strategy, gameState);
  if (!normalized) return null;
  const chosen = pickAction(normalized, rng);
  if (!chosen) return null;
  return translateChosenAction(chosen, gameState);
}

function translatePolicyDecision({ policy, selectedAction }, gameState, rng = Math.random) {
  const normalized = normalizeStrategyForGameState(policy, gameState);
  if (!normalized) return null;

  const chosen =
    selectedAction && normalized[selectedAction] ? selectedAction : pickAction(normalized, rng);
  if (!chosen) return null;

  const translated = translateChosenAction(chosen, gameState);
  if (!translated) return null;
  return {
    ...translated,
    selectedAction: chosen,
    normalizedPolicy: normalized,
  };
}

module.exports = {
  isActionLegalForGameState,
  listLegalActionsForGameState,
  normalizeStrategyForGameState,
  parseActionKey,
  pickAction,
  solverDecisionFromStrategy,
  translatePolicyDecision,
  translateChosenAction,
};
