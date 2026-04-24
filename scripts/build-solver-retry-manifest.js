#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { writeSolverScripts } = require('../solver-script-generator');

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
      'node scripts/build-solver-retry-manifest.js',
      '  --report-dir /path/to/reports',
      '  --solver-dir /path/to/TexasSolver',
      '  --output-dir retry_scripts_dir',
      '  --manifest retry-manifest.json',
      '  [--tree-profile adaptive|full|full_lite|benchmark|recovery]',
      '  [--error-pattern ETIMEDOUT]',
    ].join(' ')
  );
  process.exit(1);
}

function parseScriptMetadata(inputScript) {
  const stem = path.basename(inputScript, path.extname(inputScript));
  const parts = stem.split('__');
  if (parts.length < 4) {
    throw new Error(`Unrecognized solver script name: ${inputScript}`);
  }

  const [positionPair, line, stackToken, flop] = parts;
  const stackBb = Number(String(stackToken).replace(/bb$/i, ''));
  if (!Number.isFinite(stackBb)) {
    throw new Error(`Invalid stack token in ${inputScript}`);
  }

  return { positionPair, line, stackBb, flop };
}

function loadRetryTargets(reportDir, errorPattern) {
  const targets = new Map();
  const reportPaths = fs
    .readdirSync(reportDir)
    .filter((name) => /^part-\d+\.report\.json$/i.test(name))
    .sort()
    .map((name) => path.join(reportDir, name));

  for (const reportPath of reportPaths) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    for (const failure of report.failures || []) {
      if (errorPattern && !String(failure.error || '').includes(errorPattern)) continue;
      const meta = parseScriptMetadata(failure.inputScript);
      const key = [meta.positionPair, meta.line, meta.stackBb, meta.flop].join('|');
      if (!targets.has(key)) {
        targets.set(key, meta);
      }
    }
  }

  return [...targets.values()];
}

function groupTargets(targets) {
  const groups = new Map();
  for (const target of targets) {
    const key = [target.positionPair, target.line, target.stackBb].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        positionPair: target.positionPair,
        line: target.line,
        stackBb: target.stackBb,
        flops: [],
      });
    }
    groups.get(key).flops.push(target.flop);
  }
  return [...groups.values()];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['report-dir'] || !args['solver-dir'] || !args['output-dir'] || !args.manifest) {
    usage();
  }

  const reportDir = path.resolve(args['report-dir']);
  const solverDir = path.resolve(args['solver-dir']);
  const outputDir = path.resolve(args['output-dir']);
  const manifestPath = path.resolve(args.manifest);
  const treeProfile = args['tree-profile'] || 'adaptive';
  const errorPattern = args['error-pattern'] || null;

  const targets = loadRetryTargets(reportDir, errorPattern);
  if (targets.length === 0) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, '[]\n');
    console.log(
      JSON.stringify(
        {
          ok: true,
          count: 0,
          manifestPath,
          outputDir,
          treeProfile,
          errorPattern,
        },
        null,
        2
      )
    );
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const groups = groupTargets(targets);
  const jobs = [];

  for (const group of groups) {
    const groupDir = path.join(outputDir, group.positionPair, group.line, `${group.stackBb}bb`);
    const result = writeSolverScripts({
      solverDir,
      outputDir: groupDir,
      positionPair: group.positionPair,
      line: group.line,
      stackBb: group.stackBb,
      treeProfile,
      flops: group.flops,
    });
    jobs.push(...result.jobs);
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(jobs, null, 2)}\n`);

  const profileSummary = jobs.reduce((summary, job) => {
    summary[job.treeProfile] = (summary[job.treeProfile] || 0) + 1;
    return summary;
  }, {});

  const difficultySummary = jobs.reduce((summary, job) => {
    summary[job.difficultyBand] = (summary[job.difficultyBand] || 0) + 1;
    return summary;
  }, {});

  console.log(
    JSON.stringify(
      {
        ok: true,
        count: jobs.length,
        manifestPath,
        outputDir,
        treeProfile,
        errorPattern,
        profileSummary,
        difficultySummary,
        sample: jobs.slice(0, 5),
      },
      null,
      2
    )
  );
}

main();
