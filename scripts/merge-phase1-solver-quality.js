#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const QUALITY_RANK = {
  terminal_tail: -1,
  recovery_failed: -1,
  benchmark: 0,
  recovery: 1,
  full_lite: 2,
  full: 3,
};

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
      'node scripts/merge-phase1-solver-quality.js',
      '  --old-root /path/to/old/phase1-btn-vs-bb-srp-50bb-full',
      '  --new-root /path/to/new/phase1-btn-vs-bb-srp-50bb-full',
      '  --override-config /path/to/lonicera/solver-tail-overrides.json',
      '  --output-json merged-audit.json',
      '  [--apply]'
    ].join(' ')
  );
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeFlopFromAny(value) {
  const match = String(value || '').match(/([2-9TJQKA][shdc]){3}/i);
  return match ? match[0] : null;
}

function loadNewQuality({ newRoot, overrideConfigPath }) {
  const quality = new Map();
  const manifest = readJson(path.join(newRoot, 'manifests', 'retry-adaptive-pass-001.json'));
  const byFlop = new Map(manifest.map((row) => [row.flop, row]));
  const followupManifests = [
    path.join(
      newRoot,
      'followups',
      'retry-adaptive-pass-001-followup-002',
      'manifests',
      'retry-failed-pass-001.json'
    ),
    path.join(
      newRoot,
      'followups',
      'retry-adaptive-pass-001-followup-004',
      'manifests',
      'retry-gap-pass-001.json'
    ),
  ];

  for (const manifestPath of followupManifests) {
    if (!fs.existsSync(manifestPath)) continue;
    for (const row of readJson(manifestPath)) {
      byFlop.set(row.flop, {
        ...byFlop.get(row.flop),
        ...row,
        treeProfile: row.treeProfile || row.nextTreeProfile,
      });
    }
  }

  const runtimeDir = path.join(newRoot, 'full-retry-runtime', 'BTN_vs_BB', 'SRP_50bb');
  const rawDir = path.join(newRoot, 'full-retry-raw', 'BTN_vs_BB', 'SRP_50bb');
  for (const [flop, row] of byFlop.entries()) {
    const runtimePath = path.join(runtimeDir, `flop_${flop}.json`);
    const rawPath = path.join(rawDir, `flop_${flop}.json`);
    if (!fs.existsSync(runtimePath) || !fs.existsSync(rawPath)) continue;
    quality.set(flop, {
      quality: row.treeProfile,
      rawPath,
      runtimePath,
      source: 'wsl_retry_pipeline',
    });
  }

  const overrideConfig = readJson(overrideConfigPath);
  for (const [flop, override] of Object.entries(overrideConfig.exactOverrides || {})) {
    if (override.targetProfile === 'terminal_tail' && !quality.has(flop)) {
      quality.set(flop, {
        quality: 'terminal_tail',
        rawPath: null,
        runtimePath: null,
        source: 'wsl_terminal_tail',
      });
    }
  }

  return quality;
}

function loadOldQuality({ oldRoot }) {
  const quality = new Map();
  const runtimeDir = path.join(oldRoot, 'runtime', 'BTN_vs_BB', 'SRP_50bb');
  const rawDir = path.join(oldRoot, 'raw', 'BTN_vs_BB', 'SRP_50bb');

  for (const filename of fs.readdirSync(runtimeDir)) {
    if (!/^flop_.+\.json$/i.test(filename)) continue;
    const flop = filename.replace(/^flop_/, '').replace(/\.json$/i, '');
    quality.set(flop, {
      quality: 'full',
      rawPath: path.join(rawDir, `flop_${flop}.json`),
      runtimePath: path.join(runtimeDir, `flop_${flop}.json`),
      source: 'mac_full',
    });
  }

  const recoveryReport = readJson(path.join(oldRoot, 'reports', 'retry-recovery-pass-001.report.json'));
  for (const row of recoveryReport.results || []) {
    const flop = normalizeFlopFromAny(row.inputScript || row.rawOutputPath);
    if (!flop) continue;
    quality.set(flop, {
      quality: 'recovery',
      rawPath: path.join(rawDir, `flop_${flop}.json`),
      runtimePath: path.join(runtimeDir, `flop_${flop}.json`),
      source: row.skipped ? 'mac_recovery_existing' : 'mac_recovery_written',
    });
  }

  for (const row of recoveryReport.failures || []) {
    const flop = normalizeFlopFromAny(row.inputScript || row.rawOutputPath);
    if (!flop) continue;
    quality.set(flop, {
      quality: 'recovery_failed',
      rawPath: path.join(rawDir, `flop_${flop}.json`),
      runtimePath: path.join(runtimeDir, `flop_${flop}.json`),
      source: 'mac_recovery_failed',
    });
  }

  const benchmarkReport = readJson(path.join(oldRoot, 'reports', 'final-single-benchmark.report.json'));
  for (const row of benchmarkReport.results || []) {
    const flop = normalizeFlopFromAny(row.inputScript || row.rawOutputPath);
    if (!flop) continue;
    quality.set(flop, {
      quality: 'benchmark',
      rawPath: path.join(rawDir, `flop_${flop}.json`),
      runtimePath: path.join(runtimeDir, `flop_${flop}.json`),
      source: 'mac_benchmark',
    });
  }

  return quality;
}

function summarizePairs(rows) {
  return rows.reduce((summary, row) => {
    const key = `${row.oldQuality || 'missing'} -> ${row.newQuality || 'missing'}`;
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['old-root'] || !args['new-root'] || !args['override-config'] || !args['output-json']) {
    usage();
  }

  const oldRoot = path.resolve(args['old-root']);
  const newRoot = path.resolve(args['new-root']);
  const outputPath = path.resolve(args['output-json']);
  const apply = Object.prototype.hasOwnProperty.call(args, 'apply');

  const oldQuality = loadOldQuality({ oldRoot });
  const newQuality = loadNewQuality({ newRoot, overrideConfigPath: args['override-config'] });

  const allFlops = [...new Set([...oldQuality.keys(), ...newQuality.keys()])].sort();
  const preferNew = [];
  const preferOld = [];
  const same = [];
  const missing = [];

  for (const flop of allFlops) {
    const oldRecord = oldQuality.get(flop) || null;
    const newRecord = newQuality.get(flop) || null;
    const oldRank = QUALITY_RANK[oldRecord?.quality] ?? Number.NEGATIVE_INFINITY;
    const newRank = QUALITY_RANK[newRecord?.quality] ?? Number.NEGATIVE_INFINITY;
    const row = {
      flop,
      oldQuality: oldRecord?.quality || null,
      newQuality: newRecord?.quality || null,
      oldSource: oldRecord?.source || null,
      newSource: newRecord?.source || null,
    };

    if (!oldRecord || !newRecord) {
      missing.push(row);
      continue;
    }

    if (newRank > oldRank) {
      preferNew.push({
        ...row,
        oldRawPath: oldRecord.rawPath,
        oldRuntimePath: oldRecord.runtimePath,
        newRawPath: newRecord.rawPath,
        newRuntimePath: newRecord.runtimePath,
      });
    } else if (newRank < oldRank) {
      preferOld.push(row);
    } else {
      same.push(row);
    }
  }

  if (apply) {
    for (const row of preferNew) {
      ensureDir(path.dirname(row.oldRawPath));
      ensureDir(path.dirname(row.oldRuntimePath));
      fs.copyFileSync(row.newRawPath, row.oldRawPath);
      fs.copyFileSync(row.newRuntimePath, row.oldRuntimePath);
    }
  }

  const audit = {
    oldRoot,
    newRoot,
    applied: apply,
    summary: {
      totalFlopsCompared: allFlops.length,
      preferNewCount: preferNew.length,
      preferOldCount: preferOld.length,
      sameCount: same.length,
      missingCount: missing.length,
      preferNewByPair: summarizePairs(preferNew),
      preferOldByPair: summarizePairs(preferOld),
      sameByPair: summarizePairs(same),
    },
    terminalTailComparisons: allFlops
      .filter((flop) => (newQuality.get(flop)?.quality || null) === 'terminal_tail')
      .map((flop) => ({
        flop,
        oldQuality: oldQuality.get(flop)?.quality || null,
        newQuality: newQuality.get(flop)?.quality || null,
      })),
    preferNew,
    preferOld,
    same,
    missing,
  };

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, `${JSON.stringify(audit, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        applied: apply,
        summary: audit.summary,
      },
      null,
      2
    )
  );
}

main();
