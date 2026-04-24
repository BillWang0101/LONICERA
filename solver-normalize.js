const { classifyHand } = require('./preflop-charts');

const PLAYER_ROLE_MAP = {
  0: 'ip',
  1: 'oop',
};

const STREET_ORDER = ['flop', 'turn', 'river'];
const STREET_PREFIX = {
  flop: 'f',
  turn: 't',
  river: 'r',
};

function nextStreet(street) {
  const index = STREET_ORDER.indexOf(street);
  return index >= 0 ? STREET_ORDER[index + 1] || null : null;
}

function normalizeActionLabel(label) {
  const text = String(label || '').trim().toUpperCase();
  if (text === 'CHECK') return 'check';
  if (text === 'CALL') return 'call';
  if (text === 'FOLD') return 'fold';
  if (text === 'ALLIN' || text === 'ALL-IN') return 'allin';

  let match = text.match(/^BET\s+([0-9.]+)$/);
  if (match) return `bet_${Math.round(parseFloat(match[1]))}`;

  match = text.match(/^RAISE\s+([0-9.]+)$/);
  if (match) return `raise_${Math.round(parseFloat(match[1]))}`;

  return text.toLowerCase().replace(/\s+/g, '_');
}

function comboStringToCards(comboKey) {
  if (!comboKey || comboKey.length !== 4) return null;
  const decodeRank = (rank) =>
    ({
      A: 14,
      K: 13,
      Q: 12,
      J: 11,
      T: 10,
    })[rank] || parseInt(rank, 10);
  const decodeSuit = (suit) =>
    ({
      s: 'spades',
      h: 'hearts',
      d: 'diamonds',
      c: 'clubs',
    })[suit];

  const first = { rank: comboKey[0], suit: decodeSuit(comboKey[1]), value: decodeRank(comboKey[0]) };
  const second = { rank: comboKey[2], suit: decodeSuit(comboKey[3]), value: decodeRank(comboKey[2]) };
  if (!first.suit || !second.suit || Number.isNaN(first.value) || Number.isNaN(second.value)) return null;
  return [first, second];
}

function strategyArrayToMap(actions, frequencies) {
  if (!Array.isArray(actions) || !Array.isArray(frequencies)) return null;
  const mapped = {};
  for (let index = 0; index < actions.length; index++) {
    const value = frequencies[index];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    mapped[normalizeActionLabel(actions[index])] = value;
  }
  return mapped;
}

function buildHandClassAverages(strategyByCombo) {
  const grouped = {};

  for (const [comboKey, strategy] of Object.entries(strategyByCombo)) {
    const cards = comboStringToCards(comboKey);
    if (!cards) continue;
    const handClass = classifyHand(cards).key;
    if (!grouped[handClass]) grouped[handClass] = [];
    grouped[handClass].push(strategy);
  }

  const strategyByHandClass = {};
  for (const [handClass, entries] of Object.entries(grouped)) {
    const totals = {};
    for (const strategy of entries) {
      for (const [action, value] of Object.entries(strategy)) {
        totals[action] = (totals[action] || 0) + value;
      }
    }

    strategyByHandClass[handClass] = Object.fromEntries(
      Object.entries(totals).map(([action, value]) => [action, value / entries.length])
    );
  }

  return strategyByHandClass;
}

function appendActionToken(actionLine, street, actor, actionLabel) {
  const normalized = normalizeActionLabel(actionLabel);
  let suffix;
  if (normalized === 'check') suffix = 'x';
  else if (normalized === 'call') suffix = 'c';
  else if (normalized === 'fold') suffix = 'f';
  else if (normalized === 'allin') suffix = 'j';
  else suffix = normalized;

  const token = `${STREET_PREFIX[street]}_${actor}_${suffix}`;
  return actionLine === 'root' ? token : `${actionLine}__${token}`;
}

function ensureBucket(root, street, boardKey) {
  if (street === 'flop') {
    root.nodes ||= {};
    return root.nodes;
  }

  if (street === 'turn') {
    root.turn ||= {};
    root.turn[boardKey] ||= { nodes: {} };
    return root.turn[boardKey].nodes;
  }

  if (street === 'river') {
    root.river ||= {};
    root.river[boardKey] ||= { nodes: {} };
    return root.river[boardKey].nodes;
  }

  return null;
}

function recordStrategy(root, street, boardPath, actionLine, node) {
  if (!node?.strategy?.actions || !node?.strategy?.strategy) return;
  const boardKey =
    street === 'turn'
      ? boardPath[0]
      : street === 'river'
        ? `${boardPath[0]}|${boardPath[1]}`
        : null;
  const bucket = ensureBucket(root, street, boardKey);
  if (!bucket) return;

  const strategyByCombo = {};
  for (const [comboKey, frequencies] of Object.entries(node.strategy.strategy || {})) {
    const mapped = strategyArrayToMap(node.strategy.actions, frequencies);
    if (mapped && Object.keys(mapped).length > 0) {
      strategyByCombo[comboKey] = mapped;
    }
  }

  if (Object.keys(strategyByCombo).length === 0) return;

  bucket[actionLine] = {
    actions: node.strategy.actions.map(normalizeActionLabel),
    strategyByCombo,
    strategyByHandClass: buildHandClassAverages(strategyByCombo),
  };
}

function walkTree(root, node, street = 'flop', actionLine = 'root', boardPath = []) {
  if (!node || !street) return;

  recordStrategy(root, street, boardPath, actionLine, node);

  if (node.childrens && typeof node.childrens === 'object') {
    const actor = PLAYER_ROLE_MAP[node.player];
    for (const [rawAction, child] of Object.entries(node.childrens)) {
      const nextActionLine = actor
        ? appendActionToken(actionLine, street, actor, rawAction)
        : actionLine;
      walkTree(root, child, street, nextActionLine, boardPath);
    }
  }

  if (node.dealcards && typeof node.dealcards === 'object') {
    const upcomingStreet = nextStreet(street);
    for (const [card, child] of Object.entries(node.dealcards)) {
      walkTree(root, child, upcomingStreet, actionLine, boardPath.concat(card));
    }
  }
}

function normalizeSolverTree(rawTree) {
  const normalized = {
    version: 2,
    source: 'texassolver',
    nodes: {},
  };

  walkTree(normalized, rawTree, 'flop', 'root', []);
  return normalized;
}

module.exports = {
  appendActionToken,
  buildHandClassAverages,
  comboStringToCards,
  normalizeActionLabel,
  normalizeSolverTree,
  strategyArrayToMap,
};
