#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { discoverSolveScripts } = require('../solver-manifest');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    args[arg.slice(2)] = argv[index + 1];
    index++;
  }
  return args;
}

function usage() {
  console.error(
    [
      'Usage:',
      'node scripts/generate-solve-manifest.js',
      '  --input-dir solver_scripts_dir',
      '  --output solve-manifest.json',
      'Tip:',
      '  Use node scripts/generate-texassolver-scripts.js to create canonical solver input scripts first.',
    ].join(' ')
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (!args['input-dir'] || !args.output) usage();

const discovered = discoverSolveScripts(args['input-dir']);
const outputPath = path.resolve(args.output);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(discovered.jobs, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      ok: true,
      output: outputPath,
      count: discovered.jobs.length,
      skipped: discovered.skipped,
    },
    null,
    2
  )
);
