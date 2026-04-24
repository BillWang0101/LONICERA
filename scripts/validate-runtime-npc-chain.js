const fs = require('fs');
const path = require('path');
const { decideNpcAction } = require('../npc-orchestrator');
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
    limit: 25,
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

function buildPlayers() {
  return [
    {
      id: 'villain_oop',
      name: 'Villain',
      chips: 1000,
      bet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      isNPC: false,
      seatIndex: 0,
    },
    {
      id: 'hero_ip',
      name: SOLVER_ENABLED_PROFILE.name,
      chips: 1000,
      bet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      isNPC: true,
      npcProfile: SOLVER_ENABLED_PROFILE,
      seatIndex: 1,
      holeCards: [],
    },
  ];
}

async function probeFile(filePath, dataDir, rootCacheDir) {
  const tree = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const picked = pickComboFromTree(tree);
  const flop = parseFlopFromFilename(path.basename(filePath));
  if (!picked || !flop) return null;

  clearSolverLookupCache();

  const players = buildPlayers();
  players[1].holeCards = picked.combo;
  const gameState = {
    pot: 100,
    currentBet: 0,
    playerBet: 0,
    chips: 1000,
    minRaise: 20,
    phase: 'flop',
    activePlayers: 2,
    seatIndex: 1,
    dealerIndex: 0,
    sbIndex: 0,
    bbIndex: 1,
    totalPlayers: 2,
    bigBlind: 20,
    currentPlayerId: 'hero_ip',
    handActionLog: [{ phase: 'preflop', actorId: 'hero_ip', action: 'raise', amount: 50 }],
    handStartPlayerCount: 2,
    handStartStacks: { villain_oop: 1000, hero_ip: 1000 },
    solverDataDir: dataDir,
    solverRootCacheDir: rootCacheDir,
    solverContext: buildSolverContext(flop),
    psychMods: {},
  };

  const decision = await decideNpcAction({
    profile: SOLVER_ENABLED_PROFILE,
    holeCards: picked.combo,
    communityCards: flop,
    gameState,
    players,
    remoteConfig: { enabled: false, url: 'http://127.0.0.1:8900', timeoutMs: 800, minConfidence: 0.18 },
  });

  return {
    flop: path.basename(filePath, '.json').replace(/^flop_/, ''),
    comboKey: picked.comboKey,
    decisionSource: decision?._decisionSource || null,
    solverStatus: gameState?._decisionTrace?.status || null,
    solverReason: gameState?._decisionTrace?.reason || null,
    selectedAction: decision?.action || null,
    lookupSource: gameState?._decisionTrace?.lookupSource || null,
    fallbackReason: gameState?._decisionTrace?.fallbackReason || null,
    latencyMs: gameState?._decisionTrace?.latencyMs || null,
  };
}

async function main() {
  const { dataDir, rootCacheDir, limit } = parseArgs(process.argv);
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
      const value = row[key] || 'unknown';
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});

  console.log(
    JSON.stringify(
      {
        ok: true,
        dataDir,
        rootCacheDir,
        sampleCount: probes.length,
        decisionSources: summarize('decisionSource'),
        solverReasons: summarize('solverReason'),
        lookupSources: summarize('lookupSource'),
        fallbackReasons: summarize('fallbackReason'),
        actions: summarize('selectedAction'),
        samples: probes.slice(0, 10),
      },
      null,
      2
    )
  );
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
