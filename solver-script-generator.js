const fs = require('fs');
const path = require('path');
const { canonicalizeBoard, cardCode, enumerateCanonicalFlops } = require('./solver-board');
const { resolveTailOverride } = require('./solver-tail-overrides');

const DEFAULT_BIG_BLIND = 20;
const DEFAULT_SMALL_BLIND = 10;
const DEFAULT_THREAD_NUM = 8;
const DEFAULT_ACCURACY = 0.5;
const DEFAULT_MAX_ITERATION = 500;
const DEFAULT_PRINT_INTERVAL = 25;
const DEFAULT_DUMP_ROUNDS = 2;

const DEFAULT_TREE_SIZES = {
  flopBet: [33, 75, 130],
  flopRaise: [250, 400],
  turnBet: [50, 80, 150],
  turnRaise: [250, 400],
  riverBet: [50, 100, 200],
  riverRaise: [250, 400],
};

const TREE_PROFILES = {
  full: DEFAULT_TREE_SIZES,
  full_lite: {
    flopBet: [33, 75],
    flopRaise: [250],
    turnBet: [50, 100],
    turnRaise: [250],
    riverBet: [75, 150],
    riverRaise: [250],
  },
  benchmark: {
    flopBet: [75],
    flopRaise: [250],
    turnBet: [80],
    turnRaise: [250],
    riverBet: [100],
    riverRaise: [250],
  },
  recovery: {
    flopBet: [50, 100],
    flopRaise: [250],
    turnBet: [66, 125],
    turnRaise: [250],
    riverBet: [75, 150],
    riverRaise: [250],
  },
};

const ADAPTIVE_PROFILE_BANDS = [
  { maxScore: 29, band: 'easy', treeProfile: 'full' },
  { maxScore: 59, band: 'medium', treeProfile: 'full_lite' },
  { maxScore: 100, band: 'hard', treeProfile: 'recovery' },
];

const SPOT_LIBRARY = {
  BTN_vs_BB: {
    SRP: {
      ipRangePath: ['ranges', '6max_range', 'BTN', '2.5bb', 'BB', 'Call', 'BTN_range.txt'],
      oopRangePath: ['ranges', '6max_range', 'BTN', '2.5bb', 'BB', 'Call', 'BB_range.txt'],
      potBb: 5,
      effectiveStackBb: (stackBb) => stackBb - 2.5,
    },
    '3BP': {
      ipRangePath: ['ranges', '6max_range', 'BTN', '2.5bb', 'BB', '11.0bb', 'BTN', 'Call', 'BTN_range.txt'],
      oopRangePath: ['ranges', '6max_range', 'BTN', '2.5bb', 'BB', '11.0bb', 'BTN', 'Call', 'BB_range.txt'],
      potBb: 22,
      effectiveStackBb: (stackBb) => stackBb - 11,
    },
  },
};

function listSupportedSpots() {
  const rows = [];
  for (const [positionPair, lines] of Object.entries(SPOT_LIBRARY)) {
    for (const line of Object.keys(lines)) {
      rows.push({ positionPair, line });
    }
  }
  return rows;
}

function resolveSpotConfig({ solverDir, positionPair, line, stackBb, bigBlind = DEFAULT_BIG_BLIND, smallBlind = DEFAULT_SMALL_BLIND }) {
  const lineConfig = SPOT_LIBRARY[positionPair]?.[line];
  if (!lineConfig) {
    throw new Error(`Unsupported solver spot: ${positionPair} ${line}`);
  }

  const effectiveStackBb = lineConfig.effectiveStackBb(stackBb);
  if (!(effectiveStackBb > 0)) {
    throw new Error(`Invalid effective stack for ${positionPair} ${line} ${stackBb}bb`);
  }

  const ipRangePath = path.join(path.resolve(solverDir), ...lineConfig.ipRangePath);
  const oopRangePath = path.join(path.resolve(solverDir), ...lineConfig.oopRangePath);

  return {
    positionPair,
    line,
    stackBb,
    bigBlind,
    smallBlind,
    pot: lineConfig.potBb * bigBlind,
    effectiveStack: effectiveStackBb * bigBlind,
    ipRangePath,
    oopRangePath,
  };
}

function loadRangeFile(rangePath) {
  return fs.readFileSync(rangePath, 'utf8').trim();
}

function formatBoard(board) {
  return canonicalizeBoard(board).flop.map(cardCode).join(',');
}

function renderSizeCommands(treeSizes = DEFAULT_TREE_SIZES) {
  const lines = [];
  const append = (actor, street, action, sizes) => {
    if (!Array.isArray(sizes) || sizes.length === 0) return;
    lines.push(`set_bet_sizes ${actor},${street},${action},${sizes.join(',')}`);
  };

  append('oop', 'flop', 'bet', treeSizes.flopBet);
  append('oop', 'flop', 'raise', treeSizes.flopRaise);
  lines.push('set_bet_sizes oop,flop,allin');
  append('ip', 'flop', 'bet', treeSizes.flopBet);
  append('ip', 'flop', 'raise', treeSizes.flopRaise);
  lines.push('set_bet_sizes ip,flop,allin');

  append('oop', 'turn', 'bet', treeSizes.turnBet);
  append('oop', 'turn', 'donk', treeSizes.turnBet);
  append('oop', 'turn', 'raise', treeSizes.turnRaise);
  lines.push('set_bet_sizes oop,turn,allin');
  append('ip', 'turn', 'bet', treeSizes.turnBet);
  append('ip', 'turn', 'raise', treeSizes.turnRaise);
  lines.push('set_bet_sizes ip,turn,allin');

  append('oop', 'river', 'bet', treeSizes.riverBet);
  append('oop', 'river', 'donk', treeSizes.riverBet);
  append('oop', 'river', 'raise', treeSizes.riverRaise);
  lines.push('set_bet_sizes oop,river,allin');
  append('ip', 'river', 'bet', treeSizes.riverBet);
  append('ip', 'river', 'raise', treeSizes.riverRaise);
  lines.push('set_bet_sizes ip,river,allin');

  return lines;
}

function resolveTreeProfile(treeProfile = 'full') {
  const normalized = String(treeProfile || 'full').trim().toLowerCase();
  if (!TREE_PROFILES[normalized]) {
    throw new Error(`Unsupported tree profile: ${treeProfile}`);
  }
  return {
    name: normalized,
    sizes: TREE_PROFILES[normalized],
  };
}

function scoreFlopDifficulty(board) {
  const flop = canonicalizeBoard(board).flop;
  const values = flop.map((card) => card.value).sort((left, right) => left - right);
  const uniqueValues = [...new Set(values)];
  const suits = flop.map((card) => card.suit);
  const suitCounts = suits.reduce((counts, suit) => {
    counts[suit] = (counts[suit] || 0) + 1;
    return counts;
  }, {});
  const maxSuitCount = Math.max(...Object.values(suitCounts));
  const paired = uniqueValues.length < flop.length;
  const highCards = values.filter((value) => value >= 10).length;
  const lowCards = values.filter((value) => value <= 8).length;
  const highest = values[values.length - 1];
  const lowest = values[0];

  let score = 0;
  const features = [];

  if (paired) {
    score -= uniqueValues.length === 1 ? 20 : 8;
    features.push(uniqueValues.length === 1 ? 'trips_reduces_branching' : 'paired_reduces_branching');
  }

  if (maxSuitCount === 3) {
    score += 18;
    features.push('monotone');
  } else if (maxSuitCount === 2) {
    score += 10;
    features.push('two_tone');
  }

  if (!paired && uniqueValues.length === 3) {
    const span = highest - lowest;
    if (span <= 4) {
      score += 36;
      features.push('very_connected');
    } else if (span === 5) {
      score += 28;
      features.push('connected');
    } else if (span === 6) {
      score += 18;
      features.push('semi_connected');
    } else if (span === 7) {
      score += 10;
      features.push('loosely_connected');
    }

    let closeGapCount = 0;
    for (let index = 1; index < uniqueValues.length; index++) {
      const gap = uniqueValues[index] - uniqueValues[index - 1];
      if (gap <= 2) closeGapCount += 1;
    }
    if (closeGapCount > 0) {
      score += closeGapCount * 12;
      features.push(`close_gaps_${closeGapCount}`);
    }
  }

  if (lowCards > 0) {
    score += lowCards * 6;
    features.push(`low_cards_${lowCards}`);
  }

  if (highCards === 0) {
    score += 14;
    features.push('no_broadway');
  } else if (highCards === 1) {
    score += 6;
    features.push('single_broadway');
  }

  if (highest <= 9) {
    score += 10;
    features.push('low_top_card');
  } else if (highest >= 12) {
    score -= 8;
    features.push('high_top_card');
  }

  const normalizedScore = Math.max(0, Math.min(100, score));

  return {
    score: normalizedScore,
    features,
    paired,
    maxSuitCount,
    highest,
    lowest,
    highCards,
    lowCards,
  };
}

function selectAdaptiveTreeProfile(board) {
  const difficulty = scoreFlopDifficulty(board);
  const band =
    ADAPTIVE_PROFILE_BANDS.find((entry) => difficulty.score <= entry.maxScore) ||
    ADAPTIVE_PROFILE_BANDS[ADAPTIVE_PROFILE_BANDS.length - 1];

  const override = resolveTailOverride(board);

  return {
    ...difficulty,
    difficultyBand: band.band,
    adaptiveTreeProfile: band.treeProfile,
    treeProfile: override?.targetProfile || band.treeProfile,
    profileSource: override?.profileSource || 'adaptive_band',
    overrideReason: override?.reason || null,
    overrideRuleId: override?.ruleId || null,
  };
}

function renderSolverScript({
  board,
  ipRange,
  oopRange,
  pot,
  effectiveStack,
  outputFile = 'output_result.json',
  threadNum = DEFAULT_THREAD_NUM,
  accuracy = DEFAULT_ACCURACY,
  maxIteration = DEFAULT_MAX_ITERATION,
  printInterval = DEFAULT_PRINT_INTERVAL,
  dumpRounds = DEFAULT_DUMP_ROUNDS,
  treeProfile = 'full',
}) {
  const resolvedTreeProfile = resolveTreeProfile(treeProfile);
  const lines = [
    `set_pot ${pot}`,
    `set_effective_stack ${effectiveStack}`,
    `set_board ${formatBoard(board)}`,
    `set_range_oop ${oopRange}`,
    `set_range_ip ${ipRange}`,
    ...renderSizeCommands(resolvedTreeProfile.sizes),
    'set_allin_threshold 0.67',
    'build_tree',
    `set_thread_num ${threadNum}`,
    `set_accuracy ${accuracy}`,
    `set_max_iteration ${maxIteration}`,
    `set_print_interval ${printInterval}`,
    'set_use_isomorphism 1',
    'start_solve',
    `set_dump_rounds ${dumpRounds}`,
    `dump_result ${outputFile}`,
  ];

  return `${lines.join('\n')}\n`;
}

function normalizeRequestedFlops(flops) {
  if (!Array.isArray(flops) || flops.length === 0) return [];
  const unique = new Set();
  for (const flop of flops) {
    const cards = String(flop)
      .match(/([2-9TJQKA][shdc])/gi)
      ?.map((card) => card.trim());
    if (!cards || cards.length !== 3) {
      throw new Error(`Invalid flop: ${flop}`);
    }
    unique.add(canonicalizeBoard(cards).flop.map(cardCode).join(''));
  }
  return [...unique].sort();
}

function resolveTargetFlops({ flops, limit }) {
  const requested = normalizeRequestedFlops(flops);
  const targets = requested.length > 0 ? requested : enumerateCanonicalFlops();
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    return targets.slice(0, Math.floor(limit));
  }
  return targets;
}

function scriptFilename({ positionPair, line, stackBb, flop }) {
  return `${positionPair}__${line}__${stackBb}bb__${flop}.txt`;
}

function chunkJobs(jobs, chunkSize = 25) {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  const normalizedChunkSize = Math.max(1, Math.floor(chunkSize || 25));
  const chunks = [];

  for (let index = 0; index < jobs.length; index += normalizedChunkSize) {
    chunks.push(jobs.slice(index, index + normalizedChunkSize));
  }

  return chunks;
}

function writeSolverScripts({
  solverDir,
  outputDir,
  manifestPath,
  positionPair,
  line,
  stackBb,
  flops,
  limit,
  bigBlind = DEFAULT_BIG_BLIND,
  smallBlind = DEFAULT_SMALL_BLIND,
  treeProfile = 'full',
}) {
  const config = resolveSpotConfig({
    solverDir,
    positionPair,
    line,
    stackBb,
    bigBlind,
    smallBlind,
  });

  const ipRange = loadRangeFile(config.ipRangePath);
  const oopRange = loadRangeFile(config.oopRangePath);
  const targetFlops = resolveTargetFlops({ flops, limit });
  const absoluteOutputDir = path.resolve(outputDir);

  fs.mkdirSync(absoluteOutputDir, { recursive: true });

  const excludedJobs = [];
  const jobs = [];

  for (const flop of targetFlops) {
    const inputScript = path.join(absoluteOutputDir, scriptFilename({ positionPair, line, stackBb, flop }));
    const board = flop.match(/([2-9TJQKA][shdc])/gi);
    const adaptiveProfile = selectAdaptiveTreeProfile(board);
    const resolvedProfileName =
      String(treeProfile || 'full').trim().toLowerCase() === 'adaptive'
        ? adaptiveProfile.treeProfile
        : resolveTreeProfile(treeProfile).name;
    if (resolvedProfileName === 'terminal_tail') {
      excludedJobs.push({
        inputScript,
        positionPair,
        line,
        stackBb,
        flop,
        difficultyScore: adaptiveProfile.score,
        difficultyBand: adaptiveProfile.difficultyBand,
        difficultyFeatures: adaptiveProfile.features,
        treeProfile: resolvedProfileName,
        profileSource: adaptiveProfile.profileSource,
        overrideReason: adaptiveProfile.overrideReason,
        overrideRuleId: adaptiveProfile.overrideRuleId,
        excluded: true,
      });
      continue;
    }
    const scriptText = renderSolverScript({
      board,
      ipRange,
      oopRange,
      pot: config.pot,
      effectiveStack: config.effectiveStack,
      treeProfile: resolvedProfileName,
    });
    fs.writeFileSync(inputScript, scriptText);
    jobs.push({
      inputScript,
      positionPair,
      line,
      stackBb,
      flop,
      difficultyScore: adaptiveProfile.score,
      difficultyBand: adaptiveProfile.difficultyBand,
      difficultyFeatures: adaptiveProfile.features,
      treeProfile: resolvedProfileName,
      profileSource: adaptiveProfile.profileSource,
      overrideReason: adaptiveProfile.overrideReason,
      overrideRuleId: adaptiveProfile.overrideRuleId,
    });
  }

  if (manifestPath) {
    const absoluteManifestPath = path.resolve(manifestPath);
    fs.mkdirSync(path.dirname(absoluteManifestPath), { recursive: true });
    fs.writeFileSync(absoluteManifestPath, `${JSON.stringify(jobs, null, 2)}\n`);
  }

  return {
    outputDir: absoluteOutputDir,
    manifestPath: manifestPath ? path.resolve(manifestPath) : null,
    jobs,
    excludedJobs,
    config: {
      ...config,
      ipRangePath: path.resolve(config.ipRangePath),
      oopRangePath: path.resolve(config.oopRangePath),
      treeProfile:
        String(treeProfile || 'full').trim().toLowerCase() === 'adaptive'
          ? 'adaptive'
          : resolveTreeProfile(treeProfile).name,
    },
  };
}

module.exports = {
  ADAPTIVE_PROFILE_BANDS,
  DEFAULT_BIG_BLIND,
  DEFAULT_SMALL_BLIND,
  SPOT_LIBRARY,
  chunkJobs,
  listSupportedSpots,
  normalizeRequestedFlops,
  renderSolverScript,
  resolveSpotConfig,
  resolveTreeProfile,
  resolveTargetFlops,
  scoreFlopDifficulty,
  selectAdaptiveTreeProfile,
  scriptFilename,
  writeSolverScripts,
};
