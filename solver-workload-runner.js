const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function selectManifestEntries(index, { startPart = 1, endPart, maxParts } = {}) {
  const manifests = index.manifests || [];
  const startIndex = Math.max(0, Number(startPart || 1) - 1);
  let selected = manifests.slice(startIndex);

  if (typeof endPart === 'number' && Number.isFinite(endPart) && endPart >= startPart) {
    selected = selected.slice(0, endPart - startPart + 1);
  }

  if (typeof maxParts === 'number' && Number.isFinite(maxParts) && maxParts > 0) {
    selected = selected.slice(0, maxParts);
  }

  return selected;
}

function runWorkload({
  workloadIndexPath,
  solverDir,
  rawDir,
  runtimeDir,
  reportDir,
  timeoutMs = 300000,
  maxIteration,
  skipExisting = true,
  continueOnError = true,
  importTrees = true,
  startPart = 1,
  endPart,
  maxParts,
}) {
  const index = readJson(workloadIndexPath);
  const manifests = selectManifestEntries(index, { startPart, endPart, maxParts });
  const runnerScript = path.join(__dirname, 'scripts', 'run-texassolver-batch.js');
  const workloadRoot = path.dirname(path.resolve(workloadIndexPath));
  const absoluteRawDir = path.resolve(rawDir || path.join(workloadRoot, 'raw'));
  const absoluteRuntimeDir = path.resolve(runtimeDir || path.join(workloadRoot, 'runtime'));
  const absoluteReportDir = path.resolve(reportDir || path.join(workloadRoot, 'reports'));

  fs.mkdirSync(absoluteReportDir, { recursive: true });

  const results = [];
  for (const manifest of manifests) {
    const reportFile = path.join(
      absoluteReportDir,
      path.basename(manifest.filename || manifest.path, '.json') + '.report.json'
    );

    const args = [
      runnerScript,
      '--solver-dir',
      path.resolve(solverDir),
      '--manifest',
      path.resolve(manifest.path),
      '--raw-dir',
      absoluteRawDir,
      '--runtime-dir',
      absoluteRuntimeDir,
      '--report-file',
      reportFile,
      '--timeout-ms',
      String(timeoutMs),
    ];

    if (typeof maxIteration === 'number' && Number.isFinite(maxIteration) && maxIteration > 0) {
      args.push('--max-iteration', String(Math.floor(maxIteration)));
    }
    if (skipExisting) args.push('--skip-existing');
    if (continueOnError) args.push('--continue-on-error');
    if (importTrees) args.push('--import');

    const child = spawnSync(process.execPath, args, {
      cwd: __dirname,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });

    const row = {
      manifestPath: manifest.path,
      reportFile,
      exitCode: child.status,
      stdout: (child.stdout || '').trim().slice(0, 2000),
      stderr: (child.stderr || '').trim().slice(0, 2000),
    };
    results.push(row);

    if (child.status !== 0 && !continueOnError) {
      break;
    }
  }

  return {
    workloadIndexPath: path.resolve(workloadIndexPath),
    solverDir: path.resolve(solverDir),
    rawDir: absoluteRawDir,
    runtimeDir: absoluteRuntimeDir,
    reportDir: absoluteReportDir,
    count: results.length,
    results,
  };
}

module.exports = {
  runWorkload,
  selectManifestEntries,
};
