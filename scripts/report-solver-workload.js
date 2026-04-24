#!/usr/bin/env node

const path = require('path');
const { summarizeWorkload } = require('../solver-progress');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    args[key] = argv[index + 1];
    index++;
  }
  return args;
}

function usage() {
  console.error(
    [
      'Usage:',
      'node scripts/report-solver-workload.js',
      '  --index workload-index.json',
      '  [--raw-dir data/solver/raw]',
      '  [--runtime-dir data/solver/trees]',
    ].join(' ')
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (!args.index) usage();

const indexPath = path.resolve(args.index);
const workloadRoot = path.dirname(indexPath);
const summary = summarizeWorkload({
  indexPath,
  rawDir: args['raw-dir'] || path.join(workloadRoot, 'raw'),
  runtimeDir: args['runtime-dir'] || path.join(workloadRoot, 'runtime'),
});

console.log(JSON.stringify(summary, null, 2));
