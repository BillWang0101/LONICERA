#!/usr/bin/env node

const path = require('path');
const {
  discoverJobs,
  importSolverTree,
  loadManifest,
} = require('../solver-import');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'dry-run') {
      args[key] = true;
      continue;
    }
    args[key] = argv[index + 1];
    index++;
  }
  return args;
}

function usage() {
  console.error(
    [
      'Usage:',
      'node scripts/import-texassolver-batch.js',
      '  (--manifest imports.json | --input-dir raw_output_dir)',
      '  [--output-dir data/solver/trees]',
      '  [--dry-run]',
    ].join(' ')
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if ((!args.manifest && !args['input-dir']) || (args.manifest && args['input-dir'])) usage();

const outputDir = path.resolve(args['output-dir'] || path.join(process.cwd(), 'data', 'solver', 'trees'));
const dryRun = !!args['dry-run'];

let jobs = [];
let skipped = [];
if (args.manifest) {
  jobs = loadManifest(args.manifest);
} else {
  const discovered = discoverJobs(args['input-dir']);
  jobs = discovered.jobs;
  skipped = discovered.skipped;
}

const imported = [];
for (const job of jobs) {
  if (dryRun) {
    imported.push({
      job,
      outputPath: path.join(outputDir, job.positionPair, `${job.line}_${job.stackBb}bb`, `flop_${job.flop}.json`),
      dryRun: true,
    });
    continue;
  }
  imported.push(importSolverTree(job, outputDir));
}

console.log(
  JSON.stringify(
    {
      ok: true,
      mode: args.manifest ? 'manifest' : 'auto-discovery',
      outputDir,
      dryRun,
      importedCount: imported.length,
      skipped,
      imported,
    },
    null,
    2
  )
);
