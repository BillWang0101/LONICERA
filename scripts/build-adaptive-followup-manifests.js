#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { writeSolverScripts } = require('../solver-script-generator');
const { analyzeAdaptiveManifest, jobKey } = require('../solver-followup');

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
      'node scripts/build-adaptive-followup-manifests.js',
      '  --manifest adaptive-manifest.json',
      '  --report adaptive-report.json',
      '  --solver-dir /path/to/TexasSolver',
      '  --raw-dir /path/to/raw',
      '  --runtime-dir /path/to/runtime',
      '  --output-root followups_dir',
      '  [--upgrade-recovery-max-score 84]',
      '  [--upgrade-lite-max-score 49]',
      '  [--max-recovery-upgrades 24]',
      '  [--max-lite-upgrades 24]',
    ].join(' ')
  );
  process.exit(1);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function mergeGeneratedJobs(generatedJobs, originalJobs) {
  const originalByKey = new Map(originalJobs.map((job) => [jobKey(job), job]));
  return generatedJobs.map((job) => {
    const original = originalByKey.get(jobKey(job)) || {};
    return {
      ...original,
      ...job,
      previousTreeProfile: original.previousTreeProfile || original.treeProfile || null,
      treeProfile: job.treeProfile,
      inputScript: job.inputScript,
    };
  });
}

function writeFollowupManifest({ jobs, name, outputRoot, solverDir }) {
  const manifestsDir = ensureDir(path.join(outputRoot, 'manifests'));
  const scriptsRoot = ensureDir(path.join(outputRoot, 'scripts', name));
  const manifestPath = path.join(manifestsDir, `${name}.json`);

  if (!jobs.length) {
    fs.writeFileSync(manifestPath, '[]\n');
    return {
      name,
      manifestPath,
      count: 0,
      jobs: [],
      profileSummary: {},
      reasonSummary: {},
    };
  }

  const grouped = new Map();
  for (const job of jobs) {
    const key = [job.positionPair, job.line, job.stackBb, job.nextTreeProfile].join('|');
    if (!grouped.has(key)) {
      grouped.set(key, {
        positionPair: job.positionPair,
        line: job.line,
        stackBb: job.stackBb,
        treeProfile: job.nextTreeProfile,
        flops: [],
      });
    }
    grouped.get(key).flops.push(job.flop);
  }

  const generatedJobs = [];
  for (const group of grouped.values()) {
    const groupDir = ensureDir(
      path.join(
        scriptsRoot,
        group.positionPair,
        group.line,
        `${group.stackBb}bb`,
        group.treeProfile
      )
    );
    const generated = writeSolverScripts({
      solverDir,
      outputDir: groupDir,
      positionPair: group.positionPair,
      line: group.line,
      stackBb: group.stackBb,
      treeProfile: group.treeProfile,
      flops: group.flops,
    });
    generatedJobs.push(...generated.jobs);
  }

  const mergedJobs = mergeGeneratedJobs(generatedJobs, jobs);
  fs.writeFileSync(manifestPath, `${JSON.stringify(mergedJobs, null, 2)}\n`);

  return {
    name,
    manifestPath,
    count: mergedJobs.length,
    jobs: mergedJobs,
    profileSummary: mergedJobs.reduce((summary, job) => {
      summary[job.nextTreeProfile] = (summary[job.nextTreeProfile] || 0) + 1;
      return summary;
    }, {}),
    reasonSummary: mergedJobs.reduce((summary, job) => {
      const reason = job.followupType || 'unknown';
      summary[reason] = (summary[reason] || 0) + 1;
      return summary;
    }, {}),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (
    !args.manifest ||
    !args.report ||
    !args['solver-dir'] ||
    !args['raw-dir'] ||
    !args['runtime-dir'] ||
    !args['output-root']
  ) {
    usage();
  }

  const analysis = analyzeAdaptiveManifest({
    manifestPath: args.manifest,
    reportPath: args.report,
    rawDir: args['raw-dir'],
    runtimeDir: args['runtime-dir'],
    upgradeRecoveryMaxScore: args['upgrade-recovery-max-score']
      ? Number(args['upgrade-recovery-max-score'])
      : undefined,
    upgradeLiteMaxScore: args['upgrade-lite-max-score']
      ? Number(args['upgrade-lite-max-score'])
      : undefined,
    maxRecoveryUpgrades: args['max-recovery-upgrades']
      ? Number(args['max-recovery-upgrades'])
      : undefined,
    maxLiteUpgrades: args['max-lite-upgrades'] ? Number(args['max-lite-upgrades']) : undefined,
  });

  const outputRoot = path.resolve(args['output-root']);
  ensureDir(outputRoot);
  const auditPath = path.join(outputRoot, 'adaptive-followup-audit.json');

  const gapManifest = writeFollowupManifest({
    jobs: analysis.gapJobs,
    name: 'retry-gap-pass-001',
    outputRoot,
    solverDir: args['solver-dir'],
  });

  const pendingManifest = writeFollowupManifest({
    jobs: analysis.pendingJobs,
    name: 'resume-pending-pass-001',
    outputRoot,
    solverDir: args['solver-dir'],
  });

  const failedRetryManifest = writeFollowupManifest({
    jobs: analysis.failedRetryJobs,
    name: 'retry-failed-pass-001',
    outputRoot,
    solverDir: args['solver-dir'],
  });

  const recoveryUpgradeManifest = writeFollowupManifest({
    jobs: analysis.recoveryUpgradeCandidates,
    name: 'upgrade-recovery-to-full-lite-pass-001',
    outputRoot,
    solverDir: args['solver-dir'],
  });

  const fullLiteUpgradeManifest = writeFollowupManifest({
    jobs: analysis.fullLiteUpgradeCandidates,
    name: 'upgrade-full-lite-to-full-pass-001',
    outputRoot,
    solverDir: args['solver-dir'],
  });

  fs.writeFileSync(
    auditPath,
    `${JSON.stringify(
        {
          ...analysis,
          gapJobs: undefined,
          pendingJobs: undefined,
          failedRetryJobs: undefined,
          recoveryUpgradeCandidates: undefined,
          fullLiteUpgradeCandidates: undefined,
        },
      null,
      2
    )}\n`
  );

  console.log(
    JSON.stringify(
        {
        ok: true,
        auditPath,
        outputRoot,
        summary: analysis.summary,
        manifests: [
          gapManifest,
          pendingManifest,
          failedRetryManifest,
          recoveryUpgradeManifest,
          fullLiteUpgradeManifest,
        ].map(
          ({ name, manifestPath, count, profileSummary, reasonSummary }) => ({
            name,
            manifestPath,
            count,
            profileSummary,
            reasonSummary,
          })
        ),
      },
      null,
      2
    )
  );
}

main();
