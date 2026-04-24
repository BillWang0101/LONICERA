const fs = require('fs');
const path = require('path');
const {
  clearSolverLookupCache,
  lookupStrategyDetailed,
  warmStrategyTree,
} = require('../solver-lookup');
const { normalizeCard } = require('../solver-board');

const DEFAULT_POSITION_PAIR = 'BTN_vs_BB';
const DEFAULT_PREFLOP_LINE = 'SRP';
const DEFAULT_STACK_BB = 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    dataDir: process.env.SOLVER_DATA_DIR || '',
    rootCacheDir: process.env.SOLVER_ROOT_CACHE_DIR || '',
    limit: 50,
    prewarmDelayMs: 50,
  };

  for (let index = 2; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--data-dir') {
      args.dataDir = argv[++index];
    } else if (token === '--root-cache-dir') {
      args.rootCacheDir = argv[++index];
    } else if (token === '--limit') {
      args.limit = Number(argv[++index]) || args.limit;
    } else if (token === '--prewarm-delay-ms') {
      const value = Number(argv[++index]);
      args.prewarmDelayMs = Number.isFinite(value) && value >= 0 ? value : args.prewarmDelayMs;
    }
  }

  return args;
}

function parseCardCodes(raw) {
  const matches = String(raw || '').match(/([2-9TJQKA][shdc])/gi) || [];
  return matches.map((code) => normalizeCard(code));
}

function parseCombo(comboKey) {
  const cards = parseCardCodes(comboKey);
  return cards.length === 2 ? cards : null;
}

function parseFlopFromFilename(fileName) {
  const match = String(fileName).match(/^flop_([2-9TJQKA][shdc][2-9TJQKA][shdc][2-9TJQKA][shdc])\.json$/i);
  if (!match) return null;
  const flop = parseCardCodes(match[1]);
  return flop.length === 3 ? flop : null;
}

function buildSolverContext(flop) {
  return {
    supported: true,
    reason: null,
    phase: 'flop',
    positionPair: DEFAULT_POSITION_PAIR,
    heroRole: 'IP',
    villainRole: 'OOP',
    preflopLine: DEFAULT_PREFLOP_LINE,
    effectiveBB: DEFAULT_STACK_BB,
    flop,
    board: flop,
    actionLine: 'root',
  };
}

function pickComboFromTree(tree) {
  const root = (tree?.nodes && tree.nodes.root) || tree?.root || tree;
  const combos = root?.strategyByCombo ? Object.keys(root.strategyByCombo) : [];
  if (!combos.length) return null;
  for (const comboKey of combos) {
    const combo = parseCombo(comboKey);
    if (combo) return { comboKey, combo };
  }
  return null;
}

async function probeFile(filePath, dataDir, rootCacheDir, prewarmDelayMs) {
  const tree = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const picked = pickComboFromTree(tree);
  const flop = parseFlopFromFilename(path.basename(filePath));
  if (!picked || !flop) return null;

  const solverContext = buildSolverContext(flop);
  const holeCards = picked.combo;

  clearSolverLookupCache();
  const cold = lookupStrategyDetailed({ solverContext, holeCards, dataDir, rootCacheDir });

  clearSolverLookupCache();
  const prewarmStartedAt = Date.now();
  const pending = warmStrategyTree({
    solverContext,
    holeCards,
    dataDir,
    rootCacheDir,
  });
  await sleep(prewarmDelayMs);
  const delayed = lookupStrategyDetailed({ solverContext, holeCards, dataDir, rootCacheDir });
  const delayedProbeMs = Date.now() - prewarmStartedAt;
  await pending;
  const awaited = lookupStrategyDetailed({ solverContext, holeCards, dataDir, rootCacheDir });

  return {
    flop: path.basename(filePath, '.json').replace(/^flop_/, ''),
    comboKey: picked.comboKey,
    coldReason: cold?.meta?.reason || null,
    coldClassification: cold?.meta?.classification || null,
    coldLookupMs: cold?.meta?.lookupMs || null,
    coldLookupSource: cold?.meta?.lookupSource || null,
    delayedReason: delayed?.meta?.reason || null,
    delayedClassification: delayed?.meta?.classification || null,
    delayedLookupMs: delayed?.meta?.lookupMs || null,
    delayedLookupSource: delayed?.meta?.lookupSource || null,
    delayedProbeMs,
    awaitedReason: awaited?.meta?.reason || null,
    awaitedClassification: awaited?.meta?.classification || null,
    awaitedLookupMs: awaited?.meta?.lookupMs || null,
    awaitedLookupSource: awaited?.meta?.lookupSource || null,
  };
}

async function main() {
  const { dataDir, rootCacheDir, limit, prewarmDelayMs } = parseArgs(process.argv);
  if (!dataDir) {
    throw new Error('missing --data-dir (expected runtime root containing BTN_vs_BB/SRP_50bb)');
  }

  const targetDir = path.join(dataDir, DEFAULT_POSITION_PAIR, `${DEFAULT_PREFLOP_LINE}_${DEFAULT_STACK_BB}bb`);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`runtime dir not found: ${targetDir}`);
  }

  const files = fs
    .readdirSync(targetDir)
    .filter((name) => /^flop_[2-9TJQKA][shdc][2-9TJQKA][shdc][2-9TJQKA][shdc]\.json$/i.test(name))
    .sort()
    .slice(0, limit)
    .map((name) => path.join(targetDir, name));

  const probes = [];
  for (const filePath of files) {
    const result = await probeFile(filePath, dataDir, rootCacheDir, prewarmDelayMs);
    if (result) probes.push(result);
  }

  const summarize = (key) =>
    probes.reduce((acc, row) => {
      const value = row[key] || 'unknown';
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});

  const summary = {
    ok: true,
    dataDir,
    rootCacheDir,
    targetDir,
    sampleCount: probes.length,
    prewarmDelayMs,
    coldReasons: summarize('coldReason'),
    delayedReasons: summarize('delayedReason'),
    awaitedReasons: summarize('awaitedReason'),
    samples: probes.slice(0, 10),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message || String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
