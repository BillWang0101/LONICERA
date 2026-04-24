const fs = require('fs');
const path = require('path');
const { classifyHand } = require('./preflop-charts');
const {
  boardRunoutKey,
  canonicalizeSolverState,
  cardCode,
  flopKey,
} = require('./solver-board');

const DEFAULT_SOLVER_DIR = path.join(__dirname, 'data', 'solver', 'trees');
const STACK_BUCKETS = [30, 50, 100, 200];
const treeCache = new Map();
const treePromises = new Map();

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function classifySolverReason(reason) {
  if (reason === 'ok') return 'solver_hit';
  if (
    [
      'unsupported_context',
      'not_postflop',
      'missing_flop',
      'hand_not_started_heads_up',
      'not_heads_up_now',
      'missing_current_player',
      'missing_opponent',
      'missing_blind_roles',
      'unsupported_position_pair',
      'unsupported_preflop_line',
      'npc_not_solver_enabled',
      'board_too_short',
    ].includes(reason)
  ) {
    return 'normal_fallback';
  }
  if (reason === 'tree_loading') return 'cold_load';
  if (
    ['tree_file_missing', 'node_missing_for_action_line', 'strategy_missing_for_combo'].includes(
      reason
    )
  ) {
    return 'data_gap';
  }
  return 'solver_fallback';
}

function pickStackBucket(effectiveBB) {
  return STACK_BUCKETS.reduce((best, bucket) =>
    Math.abs(bucket - effectiveBB) < Math.abs(best - effectiveBB) ? bucket : best
  );
}

function comboKeyVariants(holeCards) {
  if (!Array.isArray(holeCards) || holeCards.length !== 2) return [];
  const first = cardCode(holeCards[0]);
  const second = cardCode(holeCards[1]);
  const highFirst =
    holeCards[0].value > holeCards[1].value ||
    (holeCards[0].value === holeCards[1].value && first.localeCompare(second) < 0);
  const ordered = highFirst ? [first, second] : [second, first];
  return [
    `${ordered[0]}${ordered[1]}`,
    `${ordered[1]}${ordered[0]}`,
    `${first}${second}`,
    `${second}${first}`,
  ].filter((value, index, all) => all.indexOf(value) === index);
}

function normalizeActionMap(strategy) {
  if (!strategy || typeof strategy !== 'object' || Array.isArray(strategy)) return null;
  const entries = Object.entries(strategy).filter(
    ([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0
  );
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return null;

  return Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
}

function resolveNode(tree, actionLine) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.nodes && typeof tree.nodes === 'object') {
    return tree.nodes[actionLine] || null;
  }
  if (actionLine === 'root') return tree.root || tree;
  return null;
}

function isRootCacheEligible(solverContext) {
  const board = solverContext?.board || solverContext?.flop || [];
  return Array.isArray(board) && board.length === 3;
}

function readTree(filePath) {
  return treeCache.get(filePath) || null;
}

function loadTreeSync(filePath) {
  if (!treeCache.has(filePath)) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    treeCache.set(filePath, parsed);
  }
  return treeCache.get(filePath);
}

function clearSolverLookupCache() {
  treeCache.clear();
  treePromises.clear();
}

function buildRootOnlyTreePayload(tree) {
  const rootNode = resolveNode(tree, 'root');
  if (!rootNode) return null;
  if (tree.nodes && typeof tree.nodes === 'object') {
    return { nodes: tree.nodes };
  }
  return { root: rootNode };
}

function writeJsonAtomic(filePath, payload) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  return fs.promises
    .writeFile(tempPath, JSON.stringify(payload), 'utf8')
    .then(() => fs.promises.rename(tempPath, filePath))
    .catch((error) =>
      fs.promises.rm(tempPath, { force: true }).catch(() => null).then(() => {
        throw error;
      })
    );
}

function buildRootCacheFilePath({ rootCacheDir, meta }) {
  if (!rootCacheDir || !meta?.positionPair || !meta?.preflopLine || !meta?.flopKey) return null;
  return path.join(
    rootCacheDir,
    meta.positionPair,
    `${meta.preflopLine}_${meta.stackBucket}bb`,
    `flop_${meta.flopKey}.json`
  );
}

function prefetchTreeFile(filePath) {
  if (treeCache.has(filePath)) {
    return Promise.resolve(treeCache.get(filePath));
  }
  if (treePromises.has(filePath)) {
    return treePromises.get(filePath);
  }

  const pending = fs.promises
    .readFile(filePath, 'utf8')
    .then((raw) => JSON.parse(raw))
    .then((parsed) => {
      treeCache.set(filePath, parsed);
      treePromises.delete(filePath);
      return parsed;
    })
    .catch((error) => {
      treePromises.delete(filePath);
      throw error;
    });

  treePromises.set(filePath, pending);
  return pending;
}

function ensureRootCacheFile({ fullFilePath, rootCacheFilePath, force = false }) {
  if (!fullFilePath || !rootCacheFilePath) return Promise.resolve(null);
  if (!force && treeCache.has(rootCacheFilePath)) {
    return Promise.resolve(treeCache.get(rootCacheFilePath));
  }
  if (!force && treePromises.has(rootCacheFilePath)) {
    return treePromises.get(rootCacheFilePath);
  }
  if (!force && fs.existsSync(rootCacheFilePath)) {
    return prefetchTreeFile(rootCacheFilePath);
  }

  const pending = prefetchTreeFile(fullFilePath)
    .then((tree) => {
      const rootPayload = buildRootOnlyTreePayload(tree);
      if (!rootPayload) {
        throw new Error(`root node missing for ${fullFilePath}`);
      }
      return fs.promises
        .mkdir(path.dirname(rootCacheFilePath), { recursive: true })
        .then(() => writeJsonAtomic(rootCacheFilePath, rootPayload))
        .then(() => {
          treeCache.set(rootCacheFilePath, rootPayload);
          return rootPayload;
        });
    })
    .then((payload) => {
      treePromises.delete(rootCacheFilePath);
      return payload;
    })
    .catch((error) => {
      treePromises.delete(rootCacheFilePath);
      throw error;
    });

  treePromises.set(rootCacheFilePath, pending);
  return pending;
}

function extractStrategy(node, holeCards) {
  if (!node || typeof node !== 'object') return null;

  if (node.strategyByCombo && typeof node.strategyByCombo === 'object') {
    for (const comboKey of comboKeyVariants(holeCards)) {
      const normalized = normalizeActionMap(node.strategyByCombo[comboKey]);
      if (normalized) return normalized;
    }
  }

  const handClass = classifyHand(holeCards).key;

  if (node.strategyByHandClass && typeof node.strategyByHandClass === 'object') {
    const normalized = normalizeActionMap(node.strategyByHandClass[handClass]);
    if (normalized) return normalized;
  }

  if (node.strategy && typeof node.strategy === 'object' && !Array.isArray(node.strategy)) {
    const direct = normalizeActionMap(node.strategy);
    if (direct) return direct;

    const byClass = normalizeActionMap(node.strategy[handClass]);
    if (byClass) return byClass;
  }

  return null;
}

function resolveBoardAwareNode(tree, solverContext) {
  const board = solverContext?.board || solverContext?.flop || [];
  if (board.length <= 3) {
    return resolveNode(tree, solverContext.actionLine || 'root');
  }

  if (board.length === 4) {
    const key = boardRunoutKey(board);
    return tree.turn?.[key]?.nodes?.[solverContext.actionLine] || null;
  }

  if (board.length >= 5) {
    const key = boardRunoutKey(board);
    return tree.river?.[key]?.nodes?.[solverContext.actionLine] || null;
  }

  return null;
}

function prepareLookup({
  solverContext,
  holeCards,
  dataDir = DEFAULT_SOLVER_DIR,
  rootCacheDir = '',
}) {
  if (!solverContext?.supported) {
    return {
      canonicalState: null,
      filePath: null,
      rootCacheFilePath: null,
      lookupFilePath: null,
      meta: {
        hit: false,
        reason: solverContext?.reason || 'unsupported_context',
        classification: classifySolverReason(solverContext?.reason || 'unsupported_context'),
      },
    };
  }
  const canonicalState = canonicalizeSolverState({
    flop: solverContext.flop,
    board: solverContext.board || solverContext.flop,
    holeCards,
  });

  const stackBucket = pickStackBucket(solverContext.effectiveBB || 0);
  const filePath = path.join(
    dataDir,
    solverContext.positionPair,
    `${solverContext.preflopLine}_${stackBucket}bb`,
    `flop_${flopKey(canonicalState.flop)}.json`
  );

  const meta = {
    hit: false,
    reason: null,
    filePath,
    stackBucket,
    positionPair: solverContext.positionPair,
    preflopLine: solverContext.preflopLine,
    actionLine: solverContext.actionLine || 'root',
    flopKey: flopKey(canonicalState.flop),
    boardKey: boardRunoutKey(canonicalState.board),
    classification: null,
    lookupMs: 0,
  };

  const rootCacheFilePath = isRootCacheEligible(solverContext)
    ? buildRootCacheFilePath({ rootCacheDir, meta })
    : null;
  const lookupFilePath =
    rootCacheFilePath &&
    (treeCache.has(rootCacheFilePath) ||
      treePromises.has(rootCacheFilePath) ||
      fs.existsSync(rootCacheFilePath))
      ? rootCacheFilePath
      : filePath;

  return { canonicalState, filePath, rootCacheFilePath, lookupFilePath, meta };
}

function warmStrategyTree({
  solverContext,
  holeCards,
  dataDir = DEFAULT_SOLVER_DIR,
  rootCacheDir = '',
}) {
  const { filePath, rootCacheFilePath } = prepareLookup({
    solverContext,
    holeCards,
    dataDir,
    rootCacheDir,
  });
  if (!filePath || !fs.existsSync(filePath)) return null;
  if (rootCacheFilePath) {
    if (fs.existsSync(rootCacheFilePath) && (solverContext?.actionLine || 'root') !== 'root') {
      const cachedTree = treeCache.get(rootCacheFilePath) || loadTreeSync(rootCacheFilePath);
      const cachedNode = resolveBoardAwareNode(cachedTree, solverContext);
      if (cachedNode) return Promise.resolve(cachedTree);
    }
    return ensureRootCacheFile({
      fullFilePath: filePath,
      rootCacheFilePath,
      force: (solverContext?.actionLine || 'root') !== 'root',
    }).catch(() => null);
  }
  return prefetchTreeFile(filePath).catch(() => null);
}

function lookupStrategyDetailed({
  solverContext,
  holeCards,
  dataDir = DEFAULT_SOLVER_DIR,
  rootCacheDir = '',
}) {
  const startedAt = nowMs();
  const { canonicalState, filePath, rootCacheFilePath, lookupFilePath, meta } = prepareLookup({
    solverContext,
    holeCards,
    dataDir,
    rootCacheDir,
  });
  const finish = (reason, strategy = null, hit = false, extra = {}) => {
    meta.hit = hit;
    meta.reason = reason;
    meta.classification = classifySolverReason(reason);
    meta.lookupMs = Math.round((nowMs() - startedAt) * 100) / 100;
    Object.assign(meta, extra);
    return { strategy, meta };
  };

  if (!canonicalState || !filePath) {
    meta.lookupMs = Math.round((nowMs() - startedAt) * 100) / 100;
    return { strategy: null, meta };
  }
  if (!fs.existsSync(filePath)) {
    return finish('tree_file_missing');
  }

  if (rootCacheFilePath) {
    if (fs.existsSync(rootCacheFilePath)) {
      if (!treeCache.has(rootCacheFilePath)) {
        loadTreeSync(rootCacheFilePath);
      }
    } else if (!treeCache.has(rootCacheFilePath)) {
      ensureRootCacheFile({ fullFilePath: filePath, rootCacheFilePath }).catch(() => null);
      return finish('tree_loading', null, false, {
        lookupSource: 'root_cache_building',
        lookupFilePath: rootCacheFilePath,
      });
    }
  } else if (!treeCache.has(filePath)) {
    prefetchTreeFile(filePath).catch(() => null);
    return finish('tree_loading', null, false, {
      lookupSource: 'full_tree',
      lookupFilePath: filePath,
    });
  }

  const tree = readTree(lookupFilePath);
  const node = resolveBoardAwareNode(tree, {
    ...solverContext,
    flop: canonicalState.flop,
    board: canonicalState.board,
  });
  if (!node) {
    if (rootCacheFilePath && lookupFilePath === rootCacheFilePath && (solverContext.actionLine || 'root') !== 'root') {
      ensureRootCacheFile({ fullFilePath: filePath, rootCacheFilePath, force: true }).catch(() => null);
      return finish('tree_loading', null, false, {
        lookupSource: 'root_cache_upgrading',
        lookupFilePath: rootCacheFilePath,
      });
    }
    return finish('node_missing_for_action_line', null, false, {
      lookupSource: rootCacheFilePath ? 'root_cache' : 'full_tree',
      lookupFilePath,
    });
  }

  const strategy = extractStrategy(node, canonicalState.holeCards);
  if (!strategy) {
    return finish('strategy_missing_for_combo', null, false, {
      lookupSource: rootCacheFilePath ? 'root_cache' : 'full_tree',
      lookupFilePath,
    });
  }

  return finish('ok', strategy, true, {
    lookupSource: rootCacheFilePath ? 'root_cache' : 'full_tree',
    lookupFilePath,
  });
}

function lookupStrategy({
  solverContext,
  holeCards,
  dataDir = DEFAULT_SOLVER_DIR,
  rootCacheDir = '',
}) {
  const { canonicalState, filePath, rootCacheFilePath, lookupFilePath } = prepareLookup({
    solverContext,
    holeCards,
    dataDir,
    rootCacheDir,
  });
  if (!canonicalState || !filePath) return null;
  if (!fs.existsSync(filePath)) return null;

  if (rootCacheFilePath) {
    if (fs.existsSync(rootCacheFilePath)) {
      if (!treeCache.has(rootCacheFilePath)) {
        loadTreeSync(rootCacheFilePath);
      }
    } else {
      const fullTree = loadTreeSync(filePath);
      const rootPayload = buildRootOnlyTreePayload(fullTree);
      if (rootPayload) {
        fs.mkdirSync(path.dirname(rootCacheFilePath), { recursive: true });
        fs.writeFileSync(rootCacheFilePath, JSON.stringify(rootPayload), 'utf8');
        treeCache.set(rootCacheFilePath, rootPayload);
      }
    }
  }

  const tree = loadTreeSync(lookupFilePath);
  const node = resolveBoardAwareNode(tree, {
    ...solverContext,
    flop: canonicalState.flop,
    board: canonicalState.board,
  });
  if (!node) return null;
  return extractStrategy(node, canonicalState.holeCards);
}

module.exports = {
  DEFAULT_SOLVER_DIR,
  boardRunoutKey,
  clearSolverLookupCache,
  comboKeyVariants,
  classifySolverReason,
  buildRootOnlyTreePayload,
  extractStrategy,
  flopKey,
  lookupStrategyDetailed,
  lookupStrategy,
  normalizeActionMap,
  pickStackBucket,
  warmStrategyTree,
};
