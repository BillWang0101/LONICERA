const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeAdaptiveManifest, compareDifficulty } = require('../solver-followup');

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

describe('solver followup analysis', () => {
  test('classifies gaps and upgrade candidates from adaptive results', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-followup-'));
    const manifestPath = path.join(tmpDir, 'adaptive-manifest.json');
    const reportPath = path.join(tmpDir, 'adaptive-report.json');
    const rawDir = path.join(tmpDir, 'raw');
    const runtimeDir = path.join(tmpDir, 'runtime');

    const manifest = [
      {
        positionPair: 'BTN_vs_BB',
        line: 'SRP',
        stackBb: 50,
        flop: 'AsKhJd',
        treeProfile: 'full',
        difficultyScore: 18,
      },
      {
        positionPair: 'BTN_vs_BB',
        line: 'SRP',
        stackBb: 50,
        flop: 'As5h3d',
        treeProfile: 'full_lite',
        difficultyScore: 10,
      },
      {
        positionPair: 'BTN_vs_BB',
        line: 'SRP',
        stackBb: 50,
        flop: 'KsJh8d',
        treeProfile: 'recovery',
        difficultyScore: 44,
      },
      {
        positionPair: 'BTN_vs_BB',
        line: 'SRP',
        stackBb: 50,
        flop: 'QsJh9d',
        treeProfile: 'full_lite',
        difficultyScore: 35,
      },
      {
        positionPair: 'BTN_vs_BB',
        line: 'SRP',
        stackBb: 50,
        flop: 'Ts4h2d',
        treeProfile: 'recovery',
        difficultyScore: 30,
      },
    ];

    writeJson(manifestPath, manifest);
    writeJson(reportPath, {
      results: [
        { ...manifest[2] },
        { ...manifest[3] },
        { ...manifest[4], skipped: true },
      ],
      failures: [
        { ...manifest[0], error: 'spawn /console_solver ETIMEDOUT' },
        { ...manifest[1], error: 'Solver did not produce /tmp/flop_As5h3d.json' },
        { ...manifest[4], error: 'Solver did not produce /tmp/flop_Ts4h2d.json' },
      ],
    });

    createOutput(rawDir, manifest[2]);
    createOutput(runtimeDir, manifest[2]);
    createOutput(rawDir, manifest[3]);
    createOutput(runtimeDir, manifest[3]);

    const analysis = analyzeAdaptiveManifest({
      manifestPath,
      reportPath,
      rawDir,
      runtimeDir,
      maxRecoveryUpgrades: 10,
      maxLiteUpgrades: 10,
    });

    expect(analysis.summary.completedCount).toBe(2);
    expect(analysis.summary.gapCount).toBe(2);
    expect(analysis.summary.pendingCount).toBe(0);
    expect(analysis.summary.failedRetryCount).toBe(1);
    expect(analysis.summary.retryCandidateCount).toBe(1);
    expect(analysis.summary.downgradedCount).toBe(1);
    expect(analysis.summary.terminalTailCount).toBe(1);
    expect(analysis.summary.upgradeSkippedCount).toBe(2);
    expect(analysis.summary.gapByErrorKind).toEqual({
      ETIMEDOUT: 1,
    });
    expect(analysis.summary.gapByNextProfile).toEqual({
      full_lite: 1,
      recovery: 1,
    });

    expect(analysis.gapJobs.map((job) => [job.flop, job.nextTreeProfile])).toEqual([
      ['As5h3d', 'recovery'],
      ['AsKhJd', 'full_lite'],
    ]);
    expect(analysis.failedRetryJobs.map((job) => [job.flop, job.nextTreeProfile])).toEqual([
      ['AsKhJd', 'full_lite'],
    ]);
    expect(analysis.downgradeCandidateJobs.map((job) => [job.flop, job.nextTreeProfile])).toEqual([
      ['As5h3d', 'recovery'],
    ]);
    expect(analysis.terminalTailJobs.map((job) => [job.flop, job.nextTreeProfile])).toEqual([
      ['Ts4h2d', 'terminal_tail'],
    ]);
    expect(analysis.pendingJobs).toEqual([]);

    expect(analysis.recoveryUpgradeCandidates).toEqual([]);
    expect(analysis.fullLiteUpgradeCandidates).toEqual([]);
    expect(analysis.skippedUpgradeJobs.map((job) => [job.flop, job.nextTreeProfile])).toEqual([
      ['KsJh8d', 'full_lite'],
      ['QsJh9d', 'full'],
    ]);
  });

  test('compareDifficulty orders by difficulty score before profile escalation', () => {
    const jobs = [
      { flop: 'Ks7h2d', difficultyScore: 44, nextTreeProfile: 'full' },
      { flop: 'Qs7h2d', difficultyScore: 18, nextTreeProfile: 'recovery' },
      { flop: 'Js7h2d', difficultyScore: 18, nextTreeProfile: 'full_lite' },
    ];

    jobs.sort(compareDifficulty);

    expect(jobs.map((job) => job.flop)).toEqual(['Qs7h2d', 'Js7h2d', 'Ks7h2d']);
  });

  test('keeps unseen incomplete jobs in pending instead of failed retry', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-followup-pending-'));
    const manifestPath = path.join(tmpDir, 'adaptive-manifest.json');
    const reportPath = path.join(tmpDir, 'adaptive-report.json');
    const rawDir = path.join(tmpDir, 'raw');
    const runtimeDir = path.join(tmpDir, 'runtime');

    const manifest = [
      {
        positionPair: 'BTN_vs_BB',
        line: 'SRP',
        stackBb: 50,
        flop: 'AsKhTd',
        treeProfile: 'full',
        difficultyScore: 21,
      },
    ];

    writeJson(manifestPath, manifest);
    writeJson(reportPath, { results: [], failures: [] });

    const analysis = analyzeAdaptiveManifest({
      manifestPath,
      reportPath,
      rawDir,
      runtimeDir,
    });

    expect(analysis.summary.pendingCount).toBe(1);
    expect(analysis.summary.failedRetryCount).toBe(0);
    expect(analysis.pendingJobs[0]).toMatchObject({
      flop: 'AsKhTd',
      treeProfile: 'full',
      nextTreeProfile: 'full',
      followupType: 'retry_candidate',
    });
  });
});
