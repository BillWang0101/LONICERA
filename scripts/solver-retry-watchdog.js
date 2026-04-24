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
    args[key] = argv[index + 1];
    index++;
  }
  return args;
}

function usage() {
  console.error(
    [
      'Usage:',
      'node scripts/solver-retry-watchdog.js',
      '  --manifest retry-manifest.json',
      '  --report-file retry-report.json',
      '  --project-dir /path/to/project',
      '  --solver-dir /path/to/TexasSolver',
      '  --raw-dir /path/to/raw',
      '  --runtime-dir /path/to/runtime',
      '  [--timeout-ms 300000]',
      '  [--max-iteration 10]',
      '  [--stale-minutes 20]',
      '  [--log-file retry-watchdog.log]',
    ].join(' ')
  );
  process.exit(1);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function logLine(logFile, message) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
}

function listProcesses() {
  const output = execSync('ps -axo pid=,etime=,command=', { encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\S+)\s+(.*)$/);
      return match
        ? { pid: Number(match[1]), etime: match[2], command: match[3] }
        : null;
    })
    .filter(Boolean);
}

function etimeToSeconds(value) {
  const text = String(value || '').trim();
  if (!text) return 0;

  const dayParts = text.split('-');
  let days = 0;
  let timePart = text;
  if (dayParts.length === 2) {
    days = Number(dayParts[0]) || 0;
    timePart = dayParts[1];
  }

  const segments = timePart.split(':').map((segment) => Number(segment) || 0);
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (segments.length === 3) {
    [hours, minutes, seconds] = segments;
  } else if (segments.length === 2) {
    [minutes, seconds] = segments;
  } else if (segments.length === 1) {
    [seconds] = segments;
  }

  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function findActiveBatches(manifestPath) {
  const manifestName = path.basename(manifestPath);
  return listProcesses().filter(
    (row) =>
      row.command.includes('scripts/run-texassolver-batch.js') &&
      (row.command.includes(manifestPath) || row.command.includes(manifestName))
  );
}

function killPids(rows, logFile) {
  for (const row of rows) {
    try {
      process.kill(row.pid, 'SIGTERM');
      logLine(logFile, `sent SIGTERM to pid=${row.pid} cmd=${row.command}`);
    } catch (_) {
      // Ignore races.
    }
  }
}

function startBatch(config) {
  const runnerScript = path.join(config.projectDir, 'scripts', 'run-texassolver-batch.js');
  const out = fs.openSync(config.logFile, 'a');
  const child = spawn(
    process.execPath,
    [
      runnerScript,
      '--solver-dir',
      config.solverDir,
      '--manifest',
      config.manifestPath,
      '--timeout-ms',
      String(config.timeoutMs),
      '--max-iteration',
      String(config.maxIteration),
      '--raw-dir',
      config.rawDir,
      '--runtime-dir',
      config.runtimeDir,
      '--report-file',
      config.reportFile,
      '--skip-existing',
      '--continue-on-error',
      '--import',
    ],
    {
      cwd: config.projectDir,
      detached: true,
      stdio: ['ignore', out, out],
    }
  );
  child.unref();
  logLine(config.logFile, `started retry batch pid=${child.pid} manifest=${config.manifestPath}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (
    !args.manifest ||
    !args['report-file'] ||
    !args['project-dir'] ||
    !args['solver-dir'] ||
    !args['raw-dir'] ||
    !args['runtime-dir']
  ) {
    usage();
  }

  const config = {
    manifestPath: path.resolve(args.manifest),
    reportFile: path.resolve(args['report-file']),
    projectDir: path.resolve(args['project-dir']),
    solverDir: path.resolve(args['solver-dir']),
    rawDir: path.resolve(args['raw-dir']),
    runtimeDir: path.resolve(args['runtime-dir']),
    timeoutMs: args['timeout-ms'] ? Number(args['timeout-ms']) : 300000,
    maxIteration: args['max-iteration'] ? Number(args['max-iteration']) : 10,
    staleMinutes: args['stale-minutes'] ? Number(args['stale-minutes']) : 20,
    logFile:
      args['log-file'] ||
      path.join(path.dirname(path.resolve(args['report-file'])), 'retry-recovery-watchdog.log'),
  };

  const manifest = readJson(config.manifestPath, []);
  const total = Array.isArray(manifest) ? manifest.length : 0;
  const report = readJson(config.reportFile, { results: [] });
  const processed = Array.isArray(report.results) ? report.results.length : 0;

  if (processed >= total && total > 0) {
    logLine(config.logFile, `retry workload complete processed=${processed}/${total}`);
    return;
  }

  const activeBatches = findActiveBatches(config.manifestPath);
  const reportStat = fs.existsSync(config.reportFile) ? fs.statSync(config.reportFile) : null;
  const reportAgeMin = reportStat ? (Date.now() - reportStat.mtimeMs) / 60000 : Infinity;
  const oldestActiveSec =
    activeBatches.length > 0 ? Math.max(...activeBatches.map((row) => etimeToSeconds(row.etime))) : 0;

  logLine(
    config.logFile,
    `inspect processed=${processed}/${total} activeBatches=${activeBatches.length} reportAgeMin=${
      Number.isFinite(reportAgeMin) ? reportAgeMin.toFixed(1) : 'n/a'
    } oldestActiveSec=${oldestActiveSec}`
  );

  if (activeBatches.length === 0) {
    startBatch(config);
    return;
  }

  if (Number.isFinite(reportAgeMin) && reportAgeMin > config.staleMinutes) {
    killPids(activeBatches, config.logFile);
    startBatch(config);
  }
}

main();
