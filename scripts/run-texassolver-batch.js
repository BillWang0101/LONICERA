#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { importSolverTree } = require('../solver-import');
const { loadSolveManifest, runSolverScript } = require('../solver-runner');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (['import', 'skip-existing', 'continue-on-error'].includes(key)) {
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
      'node scripts/run-texassolver-batch.js',
      '  --solver-dir /path/to/TexasSolver',
      '  --manifest solve-manifest.json',
      '  [--raw-dir raw_output]',
      '  [--runtime-dir data/solver/trees]',
      '  [--timeout-ms 300000]',
      '  [--max-iteration 500]',
      '  [--report-file run-report.json]',
      '  [--skip-existing]',
      '  [--continue-on-error]',
      '  [--import]',
    ].join(' ')
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (!args['solver-dir'] || !args.manifest) usage();

const rawDir = path.resolve(args['raw-dir'] || path.join(process.cwd(), 'data', 'solver', 'raw'));
const runtimeDir = path.resolve(args['runtime-dir'] || path.join(process.cwd(), 'data', 'solver', 'trees'));
const timeoutMs = args['timeout-ms'] ? Number(args['timeout-ms']) : 300000;
const maxIteration = args['max-iteration'] ? Number(args['max-iteration']) : undefined;
const reportFile = args['report-file'] ? path.resolve(args['report-file']) : null;
const skipExisting = !!args['skip-existing'];
const continueOnError = !!args['continue-on-error'];

const jobs = loadSolveManifest(args.manifest);
const results = [];
const failures = [];

fs.mkdirSync(rawDir, { recursive: true });

function pickJobMetadata(job) {
  return {
    positionPair: job.positionPair,
    line: job.line,
    stackBb: job.stackBb,
    flop: job.flop,
    treeProfile: job.treeProfile || null,
    difficultyScore: Number.isFinite(job.difficultyScore) ? job.difficultyScore : null,
    difficultyBand: job.difficultyBand || null,
    difficultyFeatures: Array.isArray(job.difficultyFeatures) ? job.difficultyFeatures : null,
  };
}

function buildPayload() {
  return {
    ok: true,
    solverDir: path.resolve(args['solver-dir']),
    rawDir,
    runtimeDir,
    count: results.length,
    importEnabled: !!args.import,
    skipExisting,
    continueOnError,
    successCount: results.filter((row) => !row.error).length,
    failureCount: failures.length,
    skippedCount: results.filter((row) => row.skipped).length,
    failures,
    results,
  };
}

function flushReport() {
  if (!reportFile) return;
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(buildPayload(), null, 2)}\n`);
}

async function main() {
  for (const job of jobs) {
    const rawOutputPath = path.join(
      rawDir,
      job.positionPair,
      `${job.line}_${job.stackBb}bb`,
      `flop_${job.flop}.json`
    );

    const row = {
      inputScript: job.inputScript,
      rawOutputPath,
      imported: false,
      skipped: false,
      ...pickJobMetadata(job),
    };

    try {
      const solveResult = await runSolverScript({
        solverDir: args['solver-dir'],
        inputScript: job.inputScript,
        outputPath: rawOutputPath,
        timeoutMs,
        maxIteration,
        skipExisting,
      });

      row.skipped = !!solveResult.skipped;

      if (args.import && fs.existsSync(rawOutputPath)) {
        const imported = importSolverTree(
          {
            input: rawOutputPath,
            positionPair: job.positionPair,
            line: job.line,
            stackBb: job.stackBb,
            flop: job.flop,
          },
          runtimeDir
        );
        row.imported = true;
        row.runtimeOutputPath = imported.outputPath;
        row.flopNodes = imported.flopNodes;
        row.turnBoards = imported.turnBoards;
        row.riverBoards = imported.riverBoards;
      }

      if (solveResult.stdout) row.stdout = solveResult.stdout.trim().slice(0, 500);
      if (solveResult.stderr) row.stderr = solveResult.stderr.trim().slice(0, 500);
      results.push(row);
      flushReport();
    } catch (error) {
      row.error = error.message;
      failures.push({
        inputScript: job.inputScript,
        rawOutputPath,
        error: error.message,
        ...pickJobMetadata(job),
      });
      results.push(row);
      flushReport();
      if (!continueOnError) {
        throw error;
      }
    }
  }

  const payload = buildPayload();
  console.log(
    JSON.stringify(
      {
        ok: true,
        reportFile,
        solverDir: payload.solverDir,
        rawDir: payload.rawDir,
        runtimeDir: payload.runtimeDir,
        count: payload.count,
        importEnabled: payload.importEnabled,
        skipExisting: payload.skipExisting,
        continueOnError: payload.continueOnError,
        successCount: payload.successCount,
        failureCount: payload.failureCount,
        skippedCount: payload.skippedCount,
        failures: payload.failures.slice(0, 10),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  flushReport();
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
