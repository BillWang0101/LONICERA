const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function createFakeSolverDir(rootDir) {
  const solverDir = path.join(rootDir, 'solver');
  const rangeDir = path.join(solverDir, 'ranges', '6max_range', 'BTN', '2.5bb', 'BB', 'Call');
  fs.mkdirSync(rangeDir, { recursive: true });
  fs.writeFileSync(path.join(rangeDir, 'BTN_range.txt'), 'AA:1.0');
  fs.writeFileSync(path.join(rangeDir, 'BB_range.txt'), 'KK:1.0');
  return solverDir;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createOutput(baseDir, job) {
  const outputPath = path.join(
    baseDir,
    job.positionPair,
    `${job.line}_${job.stackBb}bb`,
    `flop_${job.flop}.json`
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, '{}\n');
}

describe('build adaptive followup manifests', () => {
  test('writes retry and downgrade manifests while suppressing no-op upgrades', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adaptive-followup-script-'));
    const solverDir = createFakeSolverDir(tmpDir);
    const manifestPath = path.join(tmpDir, 'adaptive-manifest.json');
    const reportPath = path.join(tmpDir, 'reports', 'retry-adaptive-pass-001.report.json');
    const rawDir = path.join(tmpDir, 'raw');
    const runtimeDir = path.join(tmpDir, 'runtime');
    const outputRoot = path.join(tmpDir, 'followups');

    const manifest = [
      {
        positionPair: 'BTN_vs_BB',
        line: 'SRP',
        stackBb: 50,
        flop: 'AsKhJd',
        treeProfile: 'full',
        difficultyScore: 18,
        inputScript: '/old/full/AsKhJd.txt',
      },
      {
        positionPair: 'BTN_vs_BB',
        line: 'SRP',
        stackBb: 50,
        flop: 'As5h3d',
        treeProfile: 'full_lite',
        difficultyScore: 10,
        inputScript: '/old/full-lite/As5h3d.txt',
      },
      {
        positionPair: 'BTN_vs_BB',
        line: 'SRP',
        stackBb: 50,
        flop: 'KsJh8d',
        treeProfile: 'recovery',
        difficultyScore: 44,
        inputScript: '/old/recovery/KsJh8d.txt',
      },
      {
        positionPair: 'BTN_vs_BB',
        line: 'SRP',
        stackBb: 50,
        flop: 'QsJh9d',
        treeProfile: 'full_lite',
        difficultyScore: 35,
        inputScript: '/old/full-lite/QsJh9d.txt',
      },
    ];

    writeJson(manifestPath, manifest);
    writeJson(reportPath, {
      results: [{ ...manifest[2] }, { ...manifest[3] }],
      failures: [
        { ...manifest[0], error: 'spawn /console_solver ETIMEDOUT' },
        { ...manifest[1], error: 'Solver did not produce /tmp/flop_As5h3d.json' },
      ],
    });

    createOutput(rawDir, manifest[2]);
    createOutput(runtimeDir, manifest[2]);
    createOutput(rawDir, manifest[3]);
    createOutput(runtimeDir, manifest[3]);

    execFileSync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts', 'build-adaptive-followup-manifests.js'),
        '--manifest',
        manifestPath,
        '--report',
        reportPath,
        '--solver-dir',
        solverDir,
        '--raw-dir',
        rawDir,
        '--runtime-dir',
        runtimeDir,
        '--output-root',
        outputRoot,
        '--max-recovery-upgrades',
        '10',
        '--max-lite-upgrades',
        '10',
      ],
      { cwd: process.cwd(), stdio: 'pipe' }
    );

    const gapManifest = JSON.parse(
      fs.readFileSync(path.join(outputRoot, 'manifests', 'retry-gap-pass-001.json'), 'utf8')
    );
    const pendingManifest = JSON.parse(
      fs.readFileSync(path.join(outputRoot, 'manifests', 'resume-pending-pass-001.json'), 'utf8')
    );
    const failedRetryManifest = JSON.parse(
      fs.readFileSync(path.join(outputRoot, 'manifests', 'retry-failed-pass-001.json'), 'utf8')
    );
    const recoveryUpgradeManifest = JSON.parse(
      fs.readFileSync(
        path.join(outputRoot, 'manifests', 'upgrade-recovery-to-full-lite-pass-001.json'),
        'utf8'
      )
    );
    const fullLiteUpgradeManifest = JSON.parse(
      fs.readFileSync(
        path.join(outputRoot, 'manifests', 'upgrade-full-lite-to-full-pass-001.json'),
        'utf8'
      )
    );
    const audit = JSON.parse(
      fs.readFileSync(path.join(outputRoot, 'adaptive-followup-audit.json'), 'utf8')
    );

    expect(gapManifest).toHaveLength(2);
    expect(gapManifest.map((job) => [job.flop, job.treeProfile])).toEqual([
      ['As5h3d', 'recovery'],
      ['AsKhJd', 'full_lite'],
    ]);

    expect(pendingManifest).toEqual([]);
    expect(failedRetryManifest).toHaveLength(1);
    expect(failedRetryManifest[0].flop).toBe('AsKhJd');
    expect(failedRetryManifest[0].followupType).toBe('retry_candidate');

    expect(recoveryUpgradeManifest).toEqual([]);
    expect(fullLiteUpgradeManifest).toEqual([]);

    expect(audit.summary).toMatchObject({
      totalJobs: 4,
      completedCount: 2,
      gapCount: 2,
      pendingCount: 0,
      failedRetryCount: 1,
      downgradedCount: 1,
      upgradeSkippedCount: 2,
      recoveryUpgradeCount: 0,
      fullLiteUpgradeCount: 0,
    });
  });
});
