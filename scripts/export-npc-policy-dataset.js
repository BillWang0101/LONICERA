#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { buildModelRequest } = require('../npc-model-features');
const { normalizeCard, cardCode } = require('../solver-board');
const {
  normalizeStrategyForGameState,
  parseActionKey,
  isActionLegalForGameState,
} = require('../solver-translate');
const { getDatasetExcludedFlops } = require('../solver-tail-overrides');

const MODEL_ACTION_UNIVERSE = [
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

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    args[arg.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

function usage() {
  console.error(
    [
      'Usage:',
      'node scripts/export-npc-policy-dataset.js',
      '  --output dataset.jsonl',
      '  [--data-dir data/solver/trees]',
      '  [--position-pair BTN_vs_BB]',
      '  [--line SRP]',
      '  [--stack-bb 50]',
      '  [--manifest manifest.json]',
      '  [--exclude-flops file.txt]',
      '  [--min-quality full_lite]',
      '  [--summary-output dataset.summary.json]',
      '  [--limit 100]',
    ].join(' ')
  );
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function readManifestEntries(manifestArg) {
  if (!manifestArg) return [];
  return String(manifestArg)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((filePath) => readJson(filePath));
}

function readExcludedFlops(filePath) {
  if (!filePath) return [];
  return fs
    .readFileSync(path.resolve(filePath), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function materializeHandClass(handClass, board = []) {
  const blockers = new Set((board || []).map(cardCode));
  const suits = ['s', 'h', 'd', 'c'];
  const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
  if (!handClass || typeof handClass !== 'string') return null;
  if (/^([AKQJT2-9])\1$/.test(handClass)) {
    const rank = handClass[0];
    for (let first = 0; first < suits.length; first++) {
      for (let second = first + 1; second < suits.length; second++) {
        const cards = [`${rank}${suits[first]}`, `${rank}${suits[second]}`];
        if (cards.every((card) => !blockers.has(card))) return cards.map(normalizeCard);
      }
    }
    return null;
  }

  const match = handClass.match(/^([AKQJT2-9])([AKQJT2-9])(s|o)$/);
  if (!match) return null;
  const [, highRank, lowRank, suitedness] = match;
  if (suitedness === 's') {
    for (const suit of suits) {
      const cards = [`${highRank}${suit}`, `${lowRank}${suit}`];
      if (cards.every((card) => !blockers.has(card))) return cards.map(normalizeCard);
    }
    return null;
  }

  for (const highSuit of suits) {
    for (const lowSuit of suits) {
      if (highSuit === lowSuit) continue;
      const cards = [`${highRank}${highSuit}`, `${lowRank}${lowSuit}`];
      if (cards.every((card) => !blockers.has(card))) return cards.map(normalizeCard);
    }
  }
  return null;
}

function teacherConfidence(source) {
  if (source === 'full') return 1;
  if (source === 'full_lite') return 0.8;
  if (source === 'recovery') return 0.5;
  return 0.9;
}

function teacherQuality(source) {
  if (source === 'full') return 'full';
  if (source === 'solver') return 'full';
  if (source === 'full_lite') return 'full_lite';
  return 'recovery';
}

function qualityRank(quality) {
  if (quality === 'full') return 2;
  if (quality === 'full_lite') return 1;
  return 0;
}

function nearestBucket(value, buckets = []) {
  let best = buckets[0];
  let bestDiff = Math.abs(value - best);
  for (const bucket of buckets.slice(1)) {
    const diff = Math.abs(value - bucket);
    if (diff < bestDiff) {
      best = bucket;
      bestDiff = diff;
    }
  }
  return best;
}

function remapActionKeyToModelUniverse(actionKey, gameState) {
  if (MODEL_ACTION_UNIVERSE.includes(actionKey)) return actionKey;
  const parsed = parseActionKey(actionKey);
  if (!parsed) return null;
  if (parsed.type === 'check' || parsed.type === 'call' || parsed.type === 'fold' || parsed.type === 'allin') {
    return parsed.type;
  }
  if (parsed.type === 'bet') {
    if (parsed.size >= 300) return 'allin';
    return `bet_${nearestBucket(parsed.size, [33, 75, 130])}`;
  }
  if (parsed.type === 'raise') {
    if (parsed.size >= 600) return 'allin';
    return `raise_${nearestBucket(parsed.size, [250, 400])}`;
  }
  return null;
}

function remapStrategyToModelUniverse(strategy, gameState) {
  if (!strategy || typeof strategy !== 'object') return null;
  const remapped = {};
  let remappedActionCount = 0;
  let remappedMass = 0;
  for (const [action, weight] of Object.entries(strategy)) {
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) continue;
    const mapped = remapActionKeyToModelUniverse(action, gameState);
    if (!mapped) continue;
    if (!isActionLegalForGameState(mapped, gameState)) continue;
    remapped[mapped] = (remapped[mapped] || 0) + weight;
    if (mapped !== action) {
      remappedActionCount += 1;
      remappedMass += weight;
    }
  }
  const normalized = normalizeStrategyForGameState(remapped, gameState);
  if (!normalized) return null;
  return {
    strategy: normalized,
    remappedActionCount,
    remappedMass,
  };
}

function baseGameState({ positionPair, line, stackBb, flop }) {
  return {
    pot: 100,
    currentBet: 0,
    playerBet: 0,
    chips: stackBb * 20,
    minRaise: 20,
    phase: 'flop',
    activePlayers: 2,
    bigBlind: 20,
    _wasPreRaiser: false,
    solverContext: {
      supported: true,
      positionPair,
      preflopLine: line,
      effectiveBB: stackBb,
      flop,
      board: flop,
      actionLine: 'root',
      heroRole: 'OOP',
    },
  };
}

function buildSamplesForTree({
  tree,
  flop,
  manifestEntry,
  positionPair,
  line,
  stackBb,
}) {
  const node = tree?.nodes?.root;
  if (!node) return [];
  const source = manifestEntry?.treeProfile || 'solver';
  const samples = [];

  const appendSample = (holeCards, label, sampleType, strategy) => {
    const gameState = baseGameState({ positionPair, line, stackBb, flop });
    const modelRequest = buildModelRequest({
      profile: { name: 'baseline', style: 'balanced', aggression: 0.5, bluffFreq: 0.2 },
      holeCards,
      communityCards: flop,
      gameState,
      solverAvailable: true,
    });
    const aligned = remapStrategyToModelUniverse(strategy, gameState);
    if (!aligned?.strategy) return;
    samples.push({
      spotKey: modelRequest.spotKey,
      sampleType,
      handLabel: label,
      holeCards: holeCards.map(cardCode),
      board: modelRequest.board,
      legalActions: modelRequest.legalActions,
      teacherPolicy: aligned.strategy,
      teacherSource: source,
      confidence: teacherConfidence(source),
      quality: teacherQuality(source),
      teacherAlignment: {
        remappedActionCount: aligned.remappedActionCount,
        remappedMass: aligned.remappedMass,
      },
      contextFeatures: {
        positionPair: modelRequest.positionPair,
        preflopLine: modelRequest.preflopLine,
        effectiveBb: modelRequest.effectiveBb,
        phase: modelRequest.phase,
        actionLine: modelRequest.actionLine,
      },
      handFeatures: modelRequest.abstraction.handFeatures,
      boardFeatures: modelRequest.abstraction.boardTexture,
      abstraction: modelRequest.abstraction,
    });
  };

  for (const [combo, strategy] of Object.entries(node.strategyByCombo || {})) {
    const holeCards = combo.match(/([2-9TJQKA][shdc])/gi)?.map(normalizeCard) || null;
    if (!holeCards || holeCards.length !== 2) continue;
    appendSample(holeCards, combo, 'combo', strategy);
  }

  for (const [handClass, strategy] of Object.entries(node.strategyByHandClass || {})) {
    const holeCards = materializeHandClass(handClass, flop);
    if (!holeCards) continue;
    appendSample(holeCards, handClass, 'hand_class', strategy);
  }

  return samples;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.output) usage();

  const dataDir = path.resolve(args['data-dir'] || path.join(process.cwd(), 'data', 'solver', 'trees'));
  const positionPair = args['position-pair'] || 'BTN_vs_BB';
  const line = args.line || 'SRP';
  const stackBb = Number(args['stack-bb'] || 50);
  const treeDir = path.join(dataDir, positionPair, `${line}_${stackBb}bb`);
  const outputPath = path.resolve(args.output);
  const manifest = readManifestEntries(args.manifest);
  const manifestByFlop = new Map(manifest.map((entry) => [entry.flop, entry]));
  const excludedFlops = new Set([
    ...getDatasetExcludedFlops(),
    ...readExcludedFlops(args['exclude-flops']),
  ]);
  const minQuality = args['min-quality'] || 'full_lite';
  const minQualityRank = qualityRank(minQuality);

  const filenames = fs
    .readdirSync(treeDir)
    .filter((name) => /^flop_[2-9TJQKA][shdc].+\.json$/i.test(name))
    .sort();
  const limit = args.limit ? Math.max(1, Number(args.limit)) : filenames.length;
  const selected = filenames.slice(0, limit);
  const summaryOutputPath = path.resolve(
    args['summary-output'] || `${outputPath.replace(/\.jsonl$/i, '')}.summary.json`
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(summaryOutputPath), { recursive: true });
  const outputFd = fs.openSync(outputPath, 'w');
  const summary = {
    excludedFlops: [],
    excludedTreeCount: 0,
    excludedByReason: {
      tail_blacklist: 0,
      min_quality: 0,
    },
    teacherAlignment: {
      rowsWithRemappedActions: 0,
      remappedActionCount: 0,
      remappedMass: 0,
    },
    samplesByTeacherSource: {},
    samplesByQuality: {},
  };
  let sampleCount = 0;
  let processedTreeCount = 0;
  for (const [index, filename] of selected.entries()) {
    const tree = readJson(path.join(treeDir, filename));
    const flopKey = filename.replace(/^flop_/, '').replace(/\.json$/i, '');
    if (excludedFlops.has(flopKey)) {
      summary.excludedFlops.push(flopKey);
      summary.excludedTreeCount += 1;
      continue;
    }
    const flop = flopKey.match(/([2-9TJQKA][shdc])/gi).map(normalizeCard);
    const samples = buildSamplesForTree({
      tree,
      flop,
      manifestEntry: manifestByFlop.get(flopKey) || null,
      positionPair,
      line,
      stackBb,
    });
    const accepted = samples.filter((sample) => qualityRank(sample.quality) >= minQualityRank);
    if (!accepted.length && samples.length) {
      summary.excludedTreeCount += 1;
      summary.excludedByReason.min_quality += 1;
      continue;
    }
    for (const sample of accepted) {
      summary.samplesByTeacherSource[sample.teacherSource] =
        (summary.samplesByTeacherSource[sample.teacherSource] || 0) + 1;
      summary.samplesByQuality[sample.quality] = (summary.samplesByQuality[sample.quality] || 0) + 1;
      if (sample.teacherAlignment?.remappedActionCount > 0) {
        summary.teacherAlignment.rowsWithRemappedActions += 1;
        summary.teacherAlignment.remappedActionCount += sample.teacherAlignment.remappedActionCount;
        summary.teacherAlignment.remappedMass += sample.teacherAlignment.remappedMass;
      }
      fs.writeSync(outputFd, `${JSON.stringify(sample)}\n`);
      sampleCount += 1;
    }
    processedTreeCount += 1;
    if ((index + 1) % 100 === 0 || index === selected.length - 1) {
      console.error(
        JSON.stringify({
          progress: {
            processedTrees: index + 1,
            acceptedTrees: processedTreeCount,
            sampleCount,
          },
        })
      );
    }
  }
  fs.closeSync(outputFd);
  fs.writeFileSync(
    summaryOutputPath,
    `${JSON.stringify(
      {
        outputPath,
        treeDir,
        treeCount: selected.length,
        sampleCount,
        minQuality,
        excludedFlops: summary.excludedFlops,
        excludedTreeCount: summary.excludedTreeCount,
        excludedByReason: summary.excludedByReason,
        teacherAlignment: {
          rowsWithRemappedActions: summary.teacherAlignment.rowsWithRemappedActions,
          remappedActionCount: summary.teacherAlignment.remappedActionCount,
          remappedMass: Number(summary.teacherAlignment.remappedMass.toFixed(6)),
        },
        samplesByTeacherSource: summary.samplesByTeacherSource,
        samplesByQuality: summary.samplesByQuality,
      },
      null,
      2
    )}\n`
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        summaryOutputPath,
        treeDir,
        treeCount: selected.length,
        sampleCount,
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    MODEL_ACTION_UNIVERSE,
    remapActionKeyToModelUniverse,
    remapStrategyToModelUniverse,
  };
}
