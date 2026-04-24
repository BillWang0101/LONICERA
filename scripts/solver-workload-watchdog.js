#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (['once'].includes(key)) {
      args[key] = true;
      continue;
    }
    args[key] = argv[index + 1];
    index++;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function logLine(logFile, message) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
}

function getReportPath(reportDir, manifestFilename) {
  return path.join(reportDir, manifestFilename.replace(/\.json$/i, '.report.json'));
}

function walkLatestMatchingMtime(rootDir, predicate) {
  if (!fs.existsSync(rootDir)) return 0;
  let latest = 0;
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!predicate(fullPath, entry)) continue;
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs > latest) latest = stat.mtimeMs;
    }
  }
  return latest;
}

function getProcessedCount(reportPath) {
  if (!fs.existsSync(reportPath)) return 0;
  try {
    const report = readJson(reportPath);
    return Array.isArray(report.results) ? report.results.length : 0;
  } catch (_) {
    return 0;
  }
}

function findNextPart(index, reportDir) {
  for (let idx = 0; idx < index.manifests.length; idx++) {
    const manifest = index.manifests[idx];
    const reportPath = getReportPath(reportDir, manifest.filename || path.basename(manifest.path));
    const processed = getProcessedCount(reportPath);
    if (processed < manifest.count) {
      return {
        partNumber: idx + 1,
        manifest,
        reportPath,
        processed,
      };
    }
  }
  return null;
}

function walkLatestMtime(rootDir) {
  if (!fs.existsSync(rootDir)) return 0;
  let latest = 0;
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs > latest) latest = stat.mtimeMs;
      if (entry.isDirectory()) {
        queue.push(fullPath);
      }
    }
  }
  return latest;
}

function extractPartNumber(command) {
  const match = String(command || '').match(/part-(\d+)\.json/i);
  return match ? Number(match[1]) : null;
}

function listMatchingPids(patterns) {
  const psOutput = execSync('ps -axo pid=,command=', { encoding: 'utf8' });
  return psOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      return match ? { pid: Number(match[1]), command: match[2] } : null;
    })
    .filter(Boolean)
    .filter((row) => patterns.some((pattern) => row.command.includes(pattern)));
}

function killSolverProcesses(logFile) {
  const targets = listMatchingPids([
    'scripts/run-solver-workload.js',
    'scripts/run-texassolver-batch.js',
  ]);

  for (const target of targets) {
    try {
      process.kill(target.pid, 'SIGTERM');
      logLine(logFile, `sent SIGTERM to pid=${target.pid} cmd=${target.command}`);
    } catch (_) {
      // Ignore races.
    }
  }
}

function startBatch({
  projectDir,
  solverDir,
  timeoutMs,
  maxIteration,
  manifestPath,
  rawDir,
  runtimeDir,
  reportFile,
  logFile,
}) {
  const runnerScript = path.join(projectDir, 'scripts', 'run-texassolver-batch.js');
  const out = fs.openSync(logFile, 'a');
  const child = spawn(
    process.execPath,
    [
      runnerScript,
      '--solver-dir',
      solverDir,
      '--manifest',
      manifestPath,
      '--timeout-ms',
      String(timeoutMs),
      '--max-iteration',
      String(maxIteration),
      '--raw-dir',
      rawDir,
      '--runtime-dir',
      runtimeDir,
      '--report-file',
      reportFile,
      '--skip-existing',
      '--continue-on-error',
      '--import',
    ],
    {
      cwd: projectDir,
      detached: true,
      stdio: ['ignore', out, out],
    }
  );
  child.unref();
  logLine(logFile, `started batch pid=${child.pid} manifest=${manifestPath}`);
}

function inspectState({
  indexPath,
  projectDir,
  staleMinutes,
}) {
  const workloadRoot = path.dirname(path.resolve(indexPath));
  const reportDir = path.join(workloadRoot, 'reports');
  const rawDir = path.join(workloadRoot, 'raw');
  const runtimeDir = path.join(workloadRoot, 'runtime');
  const index = readJson(indexPath);
  const nextPart = findNextPart(index, reportDir);
  const latestRawMtime = walkLatestMtime(rawDir);
  const latestReportMtime = walkLatestMatchingMtime(reportDir, (fullPath) =>
    /part-\d+\.report\.json$/i.test(fullPath)
  );
  const now = Date.now();
  const staleMs = staleMinutes * 60 * 1000;
  const activeBatches = listMatchingPids(['scripts/run-texassolver-batch.js']);
  const activeRunners = listMatchingPids(['scripts/run-solver-workload.js']);
  const activeBatch = activeBatches[0] || null;
  const activePart = activeBatch ? extractPartNumber(activeBatch.command) : null;
  const runnerBehind = activePart && nextPart ? activePart < nextPart.partNumber : false;
  const isStale =
    activeBatches.length > 0 &&
    latestRawMtime > 0 &&
    now - latestRawMtime > staleMs &&
    latestReportMtime > 0 &&
    now - latestReportMtime > staleMs;

  return {
    workloadRoot,
    reportDir,
    rawDir,
    runtimeDir,
    index,
    nextPart,
    latestRawMtime,
    latestReportMtime,
    activeRunners,
    activeBatches,
    activePart,
    runnerBehind,
    isStale,
  };
}

function runOnce(config) {
  const state = inspectState(config);
  const logFile = config.logFile;

  if (!state.nextPart) {
    logLine(logFile, 'workload complete; no pending parts');
    return;
  }

  const currentPart = state.nextPart.partNumber;
  const reportAgeMin =
    state.latestReportMtime > 0 ? ((Date.now() - state.latestReportMtime) / 60000).toFixed(1) : 'n/a';
  const rawAgeMin =
    state.latestRawMtime > 0 ? ((Date.now() - state.latestRawMtime) / 60000).toFixed(1) : 'n/a';

  logLine(
    logFile,
    `inspect nextPart=${currentPart} processed=${state.nextPart.processed}/${state.nextPart.manifest.count} activeBatches=${state.activeBatches.length} activePart=${state.activePart || 'n/a'} rawAgeMin=${rawAgeMin} reportAgeMin=${reportAgeMin} stale=${state.isStale} runnerBehind=${state.runnerBehind}`
  );

  if (state.activeBatches.length === 0) {
    killSolverProcesses(logFile);
    startBatch({
      projectDir: config.projectDir,
      solverDir: config.solverDir,
      timeoutMs: config.timeoutMs,
      maxIteration: config.maxIteration,
      manifestPath: state.nextPart.manifest.path,
      rawDir: state.rawDir,
      runtimeDir: state.runtimeDir,
      reportFile: state.nextPart.reportPath,
      logFile,
    });
    return;
  }

  if (state.isStale || state.runnerBehind) {
    logLine(
      logFile,
      `restarting workload from part ${currentPart} (stale=${state.isStale} runnerBehind=${state.runnerBehind})`
    );
    killSolverProcesses(logFile);
    startBatch({
      projectDir: config.projectDir,
      solverDir: config.solverDir,
      timeoutMs: config.timeoutMs,
      maxIteration: config.maxIteration,
      manifestPath: state.nextPart.manifest.path,
      rawDir: state.rawDir,
      runtimeDir: state.runtimeDir,
      reportFile: state.nextPart.reportPath,
      logFile,
    });
  }
}

function usage() {
  console.error(
    [
      'Usage:',
      'node scripts/solver-workload-watchdog.js',
      '  --index workload-index.json',
      '  --solver-dir /path/to/TexasSolver',
      '  [--project-dir /path/to/project]',
      '  [--interval-seconds 300]',
      '  [--stale-minutes 20]',
      '  [--timeout-ms 180000]',
      '  [--max-iteration 10]',
      '  [--summary-file report.json]',
      '  [--log-file watchdog.log]',
      '  [--once]',
    ].join(' ')
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (!args.index || !args['solver-dir']) usage();

const config = {
  indexPath: path.resolve(args.index),
  solverDir: path.resolve(args['solver-dir']),
  projectDir: path.resolve(args['project-dir'] || process.cwd()),
  intervalSeconds: args['interval-seconds'] ? Number(args['interval-seconds']) : 300,
  staleMinutes: args['stale-minutes'] ? Number(args['stale-minutes']) : 20,
  timeoutMs: args['timeout-ms'] ? Number(args['timeout-ms']) : 180000,
  maxIteration: args['max-iteration'] ? Number(args['max-iteration']) : 10,
  summaryFile: path.resolve(
    args['summary-file'] ||
      path.join(path.dirname(path.resolve(args.index)), 'reports', 'workload-runner.summary.json')
  ),
  logFile: path.resolve(
    args['log-file'] || path.join(path.dirname(path.resolve(args.index)), 'reports', 'workload-watchdog.log')
  ),
};

runOnce(config);

if (!args.once) {
  setInterval(() => runOnce(config), Math.max(30, config.intervalSeconds) * 1000);
}
