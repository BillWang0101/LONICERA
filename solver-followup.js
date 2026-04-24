const fs = require('fs');
const path = require('path');
const { hasOutput } = require('./solver-progress');
const { resolveTailOverride } = require('./solver-tail-overrides');

const PROFILE_ORDER = {
  recovery: 0,
  full_lite: 1,
  full: 2,
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function jobKey(job) {
  return [job.positionPair, job.line, job.stackBb, job.flop].join('|');
}

function parseErrorKind(errorMessage) {
  const error = String(errorMessage || '');
  if (!error) return null;
  if (error.includes('ETIMEDOUT')) return 'ETIMEDOUT';
  if (error.includes('did not produce')) return 'NO_OUTPUT';
  return 'OTHER';
}

function downgradeProfile(treeProfile) {
  if (treeProfile === 'full') return 'full_lite';
  if (treeProfile === 'full_lite') return 'recovery';
  return 'recovery';
}

function compareDifficulty(left, right) {
  const leftScore = Number.isFinite(left?.difficultyScore) ? left.difficultyScore : Number.POSITIVE_INFINITY;
  const rightScore = Number.isFinite(right?.difficultyScore) ? right.difficultyScore : Number.POSITIVE_INFINITY;
  if (leftScore !== rightScore) return leftScore - rightScore;

  const leftProfileOrder = PROFILE_ORDER[left?.nextTreeProfile || left?.treeProfile || 'recovery'] ?? 0;
  const rightProfileOrder = PROFILE_ORDER[right?.nextTreeProfile || right?.treeProfile || 'recovery'] ?? 0;
  if (leftProfileOrder !== rightProfileOrder) return leftProfileOrder - rightProfileOrder;

  return String(left?.flop || '').localeCompare(String(right?.flop || ''));
}

function analyzeAdaptiveManifest({
  manifestPath,
  reportPath,
  rawDir,
  runtimeDir,
  upgradeRecoveryMaxScore = 84,
  upgradeLiteMaxScore = 49,
  maxRecoveryUpgrades = 24,
  maxLiteUpgrades = 24,
}) {
  const manifestJobs = readJson(manifestPath);
  const report = fs.existsSync(path.resolve(reportPath)) ? readJson(reportPath) : { results: [], failures: [] };
  const reportResults = new Map((report.results || []).map((row) => [jobKey(row), row]));
  const reportFailures = new Map((report.failures || []).map((row) => [jobKey(row), row]));

  const completedJobs = [];
  const pendingJobs = [];
  const retryCandidateJobs = [];
  const downgradeCandidateJobs = [];
  const terminalTailJobs = [];
  const gapJobs = [];
  const recoveryUpgradeCandidates = [];
  const fullLiteUpgradeCandidates = [];
  const skippedUpgradeJobs = [];

  for (const job of manifestJobs) {
    const key = jobKey(job);
    const rawExists = hasOutput(rawDir, job);
    const runtimeExists = hasOutput(runtimeDir, job);
    const reportRow = reportResults.get(key) || reportFailures.get(key) || null;
    const errorKind = parseErrorKind(reportRow?.error);
    const fullyPresent = rawExists && runtimeExists;
    const tailOverride = resolveTailOverride(job.flop);
    const baseRecord = {
      ...job,
      rawExists,
      runtimeExists,
      errorKind,
      tailOverride,
      previousTreeProfile: job.treeProfile || null,
      reportStatus: reportRow
        ? reportRow.error
          ? 'failure'
          : reportRow.skipped
            ? 'skipped'
            : 'success'
        : null,
    };

    if (fullyPresent) {
      completedJobs.push(baseRecord);

      if (job.treeProfile === 'recovery' && job.difficultyScore <= upgradeRecoveryMaxScore) {
        skippedUpgradeJobs.push({
          ...baseRecord,
          followupType: 'upgrade_skipped_existing',
          nextTreeProfile: 'full_lite',
        });
      }

      if (job.treeProfile === 'full_lite' && job.difficultyScore <= upgradeLiteMaxScore) {
        skippedUpgradeJobs.push({
          ...baseRecord,
          followupType: 'upgrade_skipped_existing',
          nextTreeProfile: 'full',
        });
      }
      continue;
    }

    if (tailOverride?.targetProfile === 'terminal_tail') {
      terminalTailJobs.push({
        ...baseRecord,
        followupType: 'terminal_tail',
        nextTreeProfile: 'terminal_tail',
      });
      continue;
    }

    const gapRecord = {
      ...baseRecord,
      nextTreeProfile:
        tailOverride?.targetProfile ||
        (errorKind ? downgradeProfile(job.treeProfile) : job.treeProfile),
      gapReason: !rawExists && !runtimeExists ? 'missing_raw_and_runtime' : !rawExists ? 'missing_raw' : 'missing_runtime',
    };

    if (tailOverride?.targetProfile && tailOverride.targetProfile !== job.treeProfile) {
      downgradeCandidateJobs.push({
        ...gapRecord,
        followupType: 'downgrade_candidate',
      });
      continue;
    }

    if (errorKind || baseRecord.reportStatus === 'failure') {
      retryCandidateJobs.push({
        ...gapRecord,
        followupType: 'retry_candidate',
      });
      continue;
    }

    pendingJobs.push({
      ...gapRecord,
      followupType: 'retry_candidate',
    });
  }

  gapJobs.push(...retryCandidateJobs, ...downgradeCandidateJobs, ...pendingJobs);
  gapJobs.sort(compareDifficulty);
  pendingJobs.sort(compareDifficulty);
  retryCandidateJobs.sort(compareDifficulty);
  downgradeCandidateJobs.sort(compareDifficulty);
  terminalTailJobs.sort(compareDifficulty);
  recoveryUpgradeCandidates.sort(compareDifficulty);
  fullLiteUpgradeCandidates.sort(compareDifficulty);

  const limitedRecoveryUpgrades = recoveryUpgradeCandidates.slice(0, Math.max(0, Math.floor(maxRecoveryUpgrades)));
  const limitedFullLiteUpgrades = fullLiteUpgradeCandidates.slice(0, Math.max(0, Math.floor(maxLiteUpgrades)));

  return {
    manifestPath: path.resolve(manifestPath),
    reportPath: path.resolve(reportPath),
    rawDir: path.resolve(rawDir),
    runtimeDir: path.resolve(runtimeDir),
    totalJobs: manifestJobs.length,
    completedJobs,
    pendingJobs,
    failedRetryJobs: retryCandidateJobs,
    retryCandidateJobs,
    downgradeCandidateJobs,
    terminalTailJobs,
    gapJobs,
    recoveryUpgradeCandidates: limitedRecoveryUpgrades,
    fullLiteUpgradeCandidates: limitedFullLiteUpgrades,
    skippedUpgradeJobs,
    summary: {
      totalJobs: manifestJobs.length,
      completedCount: completedJobs.length,
      gapCount: gapJobs.length,
      pendingCount: pendingJobs.length,
      failedRetryCount: retryCandidateJobs.length,
      retryCandidateCount: retryCandidateJobs.length,
      downgradedCount: downgradeCandidateJobs.length,
      terminalTailCount: terminalTailJobs.length,
      recoveryUpgradeCount: limitedRecoveryUpgrades.length,
      fullLiteUpgradeCount: limitedFullLiteUpgrades.length,
      upgradeSkippedCount: skippedUpgradeJobs.length,
      gapByNextProfile: gapJobs.reduce((acc, job) => {
        acc[job.nextTreeProfile] = (acc[job.nextTreeProfile] || 0) + 1;
        return acc;
      }, {}),
      gapByErrorKind: retryCandidateJobs.reduce((acc, job) => {
        const key = job.errorKind || 'UNSEEN';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      pendingByProfile: pendingJobs.reduce((acc, job) => {
        acc[job.treeProfile] = (acc[job.treeProfile] || 0) + 1;
        return acc;
      }, {}),
      failedRetryByNextProfile: retryCandidateJobs.reduce((acc, job) => {
        acc[job.nextTreeProfile] = (acc[job.nextTreeProfile] || 0) + 1;
        return acc;
      }, {}),
      downgradedByNextProfile: downgradeCandidateJobs.reduce((acc, job) => {
        acc[job.nextTreeProfile] = (acc[job.nextTreeProfile] || 0) + 1;
        return acc;
      }, {}),
      completedByProfile: completedJobs.reduce((acc, job) => {
        acc[job.treeProfile] = (acc[job.treeProfile] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

module.exports = {
  analyzeAdaptiveManifest,
  compareDifficulty,
  downgradeProfile,
  jobKey,
  parseErrorKind,
};
