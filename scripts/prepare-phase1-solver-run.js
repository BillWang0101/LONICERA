#!/usr/bin/env node

const path = require('path');
const { writePhaseWorkload } = require('../solver-workload');

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
      'node scripts/prepare-phase1-solver-run.js',
      '  --solver-dir /path/to/TexasSolver-v0.2.0-MacOs',
      '  --output-root phase1_output_dir',
      '  [--position-pair BTN_vs_BB]',
      '  [--line SRP]',
      '  [--stack-bb 50]',
      '  [--tree-profile adaptive|full|full_lite|benchmark|recovery]',
      '  [--chunk-size 25]',
      '  [--limit 100]',
      '  [--flops As7h2d,Kc7d2h]',
    ].join(' ')
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (!args['solver-dir'] || !args['output-root']) usage();

const result = writePhaseWorkload({
  solverDir: args['solver-dir'],
  outputRoot: args['output-root'],
  positionPair: args['position-pair'] || 'BTN_vs_BB',
  line: String(args.line || 'SRP').toUpperCase(),
  stackBb: Number(args['stack-bb'] || 50),
  treeProfile: args['tree-profile'] || 'adaptive',
  chunkSize: args['chunk-size'] ? Number(args['chunk-size']) : 25,
  limit: args.limit ? Number(args.limit) : undefined,
  flops: args.flops ? args.flops.split(',').map((value) => value.trim()).filter(Boolean) : undefined,
});

const firstManifest = result.workloadIndex.manifests[0]?.path || null;

console.log(
  JSON.stringify(
    {
      ok: true,
      outputRoot: result.outputRoot,
      scriptsDir: result.scriptsDir,
      manifestsDir: result.manifestsDir,
      indexPath: result.indexPath,
      totalJobs: result.jobs.length,
      totalChunks: result.chunks.length,
      firstManifest,
      exampleRunCommand: firstManifest
        ? [
            'node scripts/run-texassolver-batch.js',
            `--solver-dir "${path.resolve(args['solver-dir'])}"`,
            `--manifest "${firstManifest}"`,
            '--skip-existing',
            '--continue-on-error',
            '--import',
          ].join(' ')
        : null,
      config: result.config,
    },
    null,
    2
  )
);
