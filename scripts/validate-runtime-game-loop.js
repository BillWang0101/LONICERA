const fs = require('fs');
const path = require('path');
const { PokerGame } = require('../engine');
const { clearSolverLookupCache } = require('../solver-lookup');
const { normalizeCard } = require('../solver-board');

const DEFAULT_POSITION_PAIR = 'BTN_vs_BB';
const DEFAULT_PREFLOP_LINE = 'SRP';
const DEFAULT_STACK_BB = 50;
const SOLVER_ENABLED_PROFILE = {
  name: '诸葛亮',
  style: 'tricky',
  tightness: 0.5,
  bluffFreq: 0.35,
  aggression: 0.6,
  cbetFreq: 0.7,
  checkRaiseFreq: 0.25,
};

function parseArgs(argv) {
  const args = {
    dataDir: process.env.SOLVER_DATA_DIR || '',
    rootCacheDir: process.env.SOLVER_ROOT_CACHE_DIR || '',
    limit: 10,
    summaryOutput: '',
    minSolverHitRate: 1,
    maxFallbacks: 0,
    maxCoveredFallbacks: 0,
  };

  for (let index = 2; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--data-dir') {
      args.dataDir = argv[++index];
    } else if (token === '--root-cache-dir') {
      args.rootCacheDir = argv[++index];
    } else if (token === '--limit') {
      const value = Number(argv[++index]);
      args.limit = Number.isFinite(value) && value > 0 ? value : args.limit;
    } else if (token === '--summary-output') {
      args.summaryOutput = argv[++index] || '';
    } else if (token === '--min-solver-hit-rate') {
      const value = Number(argv[++index]);
      args.minSolverHitRate = Number.isFinite(value) ? value : args.minSolverHitRate;
    } else if (token === '--max-fallbacks') {
      const value = Number(argv[++index]);
      args.maxFallbacks = Number.isFinite(value) ? value : args.maxFallbacks;
    } else if (token === '--max-covered-fallbacks') {
      const value = Number(argv[++index]);
      args.maxCoveredFallbacks = Number.isFinite(value) ? value : args.maxCoveredFallbacks;
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

function waitForNpcAction(player, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (player.lastAction) {
        clearInterval(timer);
        resolve(player.lastAction);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error('timeout waiting for npc action'));
      }
    }, 5);
  });
}

async function probeFile(filePath, dataDir, rootCacheDir) {
  const relativePath = path.relative(dataDir, filePath);
  const rootCacheFilePath = path.join(rootCacheDir, relativePath);
  const sourcePath = fs.existsSync(rootCacheFilePath) ? rootCacheFilePath : filePath;
  const tree = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const picked = pickComboFromTree(tree);
  const flop = parseFlopFromFilename(path.basename(filePath));
  if (!picked || !flop) return null;

  clearSolverLookupCache();

  const game = new PokerGame(`runtime_loop_${path.basename(filePath, '.json')}`, {
    smallBlind: 10,
    bigBlind: 20,
    solverDataDir: dataDir,
    solverRootCacheDir: rootCacheDir,
  });
  const events = [];
  game._logEvent = (event, data = {}) => {
    events.push({ event, data });
  };
  game.speedMultiplier = 1000;
  game.onMessage = () => {};
  game.onUpdate = () => {};
  game.onChat = () => {};
  game.onRoundEnd = () => {};

  const npc = game.addPlayer({
    id: 'hero_ip',
    name: SOLVER_ENABLED_PROFILE.name,
    isNPC: true,
    npcProfile: SOLVER_ENABLED_PROFILE,
  });
  const human = game.addPlayer({ id: 'villain_oop', name: 'Hero' });

  game.players = [human, npc];
  game.players.forEach((player, seatIndex) => {
    player.seatIndex = seatIndex;
    player.folded = false;
    player.allIn = false;
    player.bet = 0;
    player.totalBet = 0;
    player.chips = 1000;
    player.lastAction = null;
  });
  npc.holeCards = picked.combo;
  human.holeCards = [normalizeCard('As'), normalizeCard('Kd')];

  game.isRunning = true;
  game.phase = 'flop';
  game.communityCards = flop;
  const npcIndex = game.players.indexOf(npc);
  const humanIndex = game.players.indexOf(human);
  game.dealerIndex = npcIndex;
  game.sbIndex = npcIndex;
  game.bbIndex = humanIndex;
  game.currentPlayerIndex = npcIndex;
  game.handStartPlayerCount = 2;
  game.handStartStacks = { hero_ip: 1000, villain_oop: 1000 };
  game.handActionLog = [
    {
      phase: 'preflop',
      playerId: npc.id,
      action: 'raise',
      currentBetBeforeAction: 20,
      playerBetAfterAction: 50,
      contribution: 50,
      potBeforeAction: 30,
      toCallBeforeAction: 20,
    },
  ];
  game.preflopRaiserId = npc.id;

  // This probe only needs the NPC decision-chain result. Do not let the
  // synthetic hand continue into later streets, because the scripted setup
  // does not build a full deck / full hand lifecycle.
  game.handleAction = () => {};

  game.processNPCTurn();
  await waitForNpcAction(npc, 1000);

  if (game._npcTimer) {
    clearTimeout(game._npcTimer);
    game._npcTimer = null;
  }
  if (game.actionTimeout) {
    clearTimeout(game.actionTimeout);
    game.actionTimeout = null;
  }
  game.isRunning = false;

  const solverHit = events.find((entry) => entry.event === 'solver_hit');
  const decisionFallback = events.find((entry) => entry.event === 'decision_fallback');
  const runtimeSummary = events.find((entry) => entry.event === 'runtime_rollout_summary');

  return {
    flop: path.basename(filePath, '.json').replace(/^flop_/, ''),
    comboKey: picked.comboKey,
    action: npc.lastAction?.action || null,
    amount: npc.lastAction?.amount || 0,
    solverHit: !!solverHit,
    fallback: !!decisionFallback,
    solverReason: solverHit?.data?.reason || null,
    lookupSource: solverHit?.data?.lookupSource || null,
    latencyMs: solverHit?.data?.latencyMs ?? null,
    fallbackReason: decisionFallback?.data?.fallbackReason || decisionFallback?.data?.reason || null,
    coveredFallback:
      decisionFallback?.data?.coverageStatus === 'covered_spot' ||
      decisionFallback?.data?.solverTrace?.classification === 'cold_load' ||
      false,
    runtimeSummary: !!runtimeSummary,
  };
}

function percentile(values, p) {
  const sorted = values
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function main() {
  const {
    dataDir,
    rootCacheDir,
    limit,
    summaryOutput,
    minSolverHitRate,
    maxFallbacks,
    maxCoveredFallbacks,
  } = parseArgs(process.argv);
  if (!dataDir) throw new Error('missing --data-dir');
  if (!rootCacheDir) throw new Error('missing --root-cache-dir');

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
    const result = await probeFile(filePath, dataDir, rootCacheDir);
    if (result) probes.push(result);
  }

  const summarize = (key) =>
    probes.reduce((acc, row) => {
      const value = row[key] ?? 'unknown';
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
  const summarizeWhere = (rows, key) =>
    rows.reduce((acc, row) => {
      const value = row[key] ?? 'unknown';
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});

  const solverHitCount = probes.filter((row) => row.solverHit).length;
  const fallbackCount = probes.filter((row) => row.fallback).length;
  const coveredFallbackCount = probes.filter((row) => row.coveredFallback).length;
  const latencies = probes.map((row) => row.latencyMs);
  const solverHitRate = probes.length ? solverHitCount / probes.length : 0;
  const latencyValues = latencies.filter((value) => typeof value === 'number' && Number.isFinite(value));
  const latency = {
    minMs: latencyValues.length ? Math.min(...latencyValues) : null,
    maxMs: latencyValues.length ? Math.max(...latencyValues) : null,
    avgMs: latencyValues.length
      ? Math.round((latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length) * 100) / 100
      : null,
    p95Ms: percentile(latencyValues, 95),
  };
  const checks = {
    minSolverHitRate,
    maxFallbacks,
    maxCoveredFallbacks,
    passed:
      solverHitRate >= minSolverHitRate &&
      fallbackCount <= maxFallbacks &&
      coveredFallbackCount <= maxCoveredFallbacks,
  };
  const summary = {
    ok: checks.passed,
    dataDir,
    rootCacheDir,
    sampleCount: probes.length,
    solverHitCount,
    fallbackCount,
    coveredFallbackCount,
    solverHitRate,
    solverHits: summarize('solverHit'),
    fallbacks: summarize('fallback'),
    coveredFallbacks: summarize('coveredFallback'),
    lookupSources: summarize('lookupSource'),
    actions: summarize('action'),
    fallbackReasons: summarizeWhere(
      probes.filter((row) => row.fallback),
      'fallbackReason'
    ),
    runtimeSummaries: summarize('runtimeSummary'),
    latency,
    checks,
    samples: probes.slice(0, 10),
  };

  if (summaryOutput) {
    fs.mkdirSync(path.dirname(summaryOutput), { recursive: true });
    fs.writeFileSync(summaryOutput, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify(summary, null, 2));
  if (!checks.passed) process.exitCode = 1;
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
