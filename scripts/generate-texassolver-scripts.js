#!/usr/bin/env node

const { listSupportedSpots, writeSolverScripts } = require('../solver-script-generator');

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
  const spots = listSupportedSpots()
    .map(({ positionPair, line }) => `${positionPair}:${line}`)
    .join(', ');
  console.error(
    [
      'Usage:',
      'node scripts/generate-texassolver-scripts.js',
      '  --solver-dir /path/to/TexasSolver-v0.2.0-MacOs',
      '  --output-dir solver_scripts_dir',
      '  --position-pair BTN_vs_BB',
      '  --line SRP',
      '  --stack-bb 50',
      '  [--tree-profile adaptive|full|full_lite|benchmark|recovery]',
      '  [--flops As7h2d,Kc7d2h]',
      '  [--limit 100]',
      '  [--manifest solve-manifest.json]',
      `Supported spots: ${spots}`,
    ].join(' ')
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (!args['solver-dir'] || !args['output-dir'] || !args['position-pair'] || !args.line || !args['stack-bb']) {
  usage();
}

const result = writeSolverScripts({
  solverDir: args['solver-dir'],
  outputDir: args['output-dir'],
  manifestPath: args.manifest,
  positionPair: args['position-pair'],
  line: String(args.line).toUpperCase(),
  stackBb: Number(args['stack-bb']),
  treeProfile: args['tree-profile'] || 'adaptive',
  flops: args.flops ? args.flops.split(',').map((value) => value.trim()).filter(Boolean) : undefined,
  limit: args.limit ? Number(args.limit) : undefined,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      outputDir: result.outputDir,
      manifestPath: result.manifestPath,
      count: result.jobs.length,
      sample: result.jobs.slice(0, 5),
      config: result.config,
    },
    null,
    2
  )
);
