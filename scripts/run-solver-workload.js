#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { runWorkload } = require('../solver-workload-runner');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (['no-import', 'no-skip-existing', 'stop-on-error'].includes(key)) {
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
      'node scripts/run-solver-workload.js',
      '  --index workload-index.json',
      '  --solver-dir /path/to/TexasSolver-v0.2.0-MacOs',
      '  [--raw-dir raw_output_dir]',
      '  [--runtime-dir runtime_output_dir]',
      '  [--report-dir reports_dir]',
      '  [--timeout-ms 300000]',
      '  [--max-iteration 10]',
      '  [--start-part 1]',
      '  [--end-part 3]',
      '  [--max-parts 2]',
      '  [--no-import]',
      '  [--no-skip-existing]',
      '  [--stop-on-error]',
      '  [--summary-file workload-run.json]',
    ].join(' ')
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (!args.index || !args['solver-dir']) usage();

const result = runWorkload({
  workloadIndexPath: args.index,
  solverDir: args['solver-dir'],
  rawDir: args['raw-dir'],
  runtimeDir: args['runtime-dir'],
  reportDir: args['report-dir'],
  timeoutMs: args['timeout-ms'] ? Number(args['timeout-ms']) : undefined,
  maxIteration: args['max-iteration'] ? Number(args['max-iteration']) : undefined,
  skipExisting: !args['no-skip-existing'],
  continueOnError: !args['stop-on-error'],
  importTrees: !args['no-import'],
  startPart: args['start-part'] ? Number(args['start-part']) : undefined,
  endPart: args['end-part'] ? Number(args['end-part']) : undefined,
  maxParts: args['max-parts'] ? Number(args['max-parts']) : undefined,
});

if (args['summary-file']) {
  const summaryFile = path.resolve(args['summary-file']);
  fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
  fs.writeFileSync(summaryFile, `${JSON.stringify(result, null, 2)}\n`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      workloadIndexPath: result.workloadIndexPath,
      reportDir: result.reportDir,
      count: result.count,
      results: result.results.map((row) => ({
        manifestPath: row.manifestPath,
        reportFile: row.reportFile,
        exitCode: row.exitCode,
      })),
    },
    null,
    2
  )
);
