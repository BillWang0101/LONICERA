#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { normalizeSolverTree } = require('../solver-normalize');

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    parsed[arg.slice(2)] = argv[index + 1];
    index++;
  }
  return parsed;
}

function usage() {
  console.error(
    [
      'Usage:',
      'node scripts/import-texassolver-tree.js',
      '  --input raw.json',
      '  --position-pair BTN_vs_BB',
      '  --line SRP',
      '  --stack-bb 50',
      '  --flop As7h2d',
      '  [--output-dir data/solver/trees]',
    ].join(' ')
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args['position-pair'] || !args.line || !args['stack-bb'] || !args.flop) {
  usage();
}

const inputPath = path.resolve(args.input);
const outputDir = path.resolve(args['output-dir'] || path.join(process.cwd(), 'data', 'solver', 'trees'));
const outputPath = path.join(
  outputDir,
  args['position-pair'],
  `${args.line}_${args['stack-bb']}bb`,
  `flop_${args.flop}.json`
);

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const normalized = normalizeSolverTree(raw);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(normalized, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      ok: true,
      input: inputPath,
      output: outputPath,
      flopNodes: Object.keys(normalized.nodes || {}).length,
      turnBoards: Object.keys(normalized.turn || {}).length,
      riverBoards: Object.keys(normalized.river || {}).length,
    },
    null,
    2
  )
);
