const fs = require('fs');
const path = require('path');
const { normalizeSolverTree } = require('./solver-normalize');

const AUTO_FILENAME_PATTERNS = [
  /^(?<positionPair>[A-Z]+_vs_[A-Z]+)__(?<line>SRP|3BP)__(?<stackBb>\d+)bb__(?<flop>[2-9TJQKA][shdc][2-9TJQKA][shdc][2-9TJQKA][shdc])\.json$/i,
  /^(?<positionPair>[A-Z]+_vs_[A-Z]+)_(?<line>SRP|3BP)_(?<stackBb>\d+)bb_(?<flop>[2-9TJQKA][shdc][2-9TJQKA][shdc][2-9TJQKA][shdc])\.json$/i,
];

function normalizeMeta(meta, baseDir = process.cwd()) {
  return {
    input: path.resolve(baseDir, meta.input),
    positionPair: meta.positionPair,
    line: meta.line,
    stackBb: Number(meta.stackBb),
    flop: meta.flop,
  };
}

function parseRawSolverFilename(filename) {
  const base = path.basename(filename);
  for (const pattern of AUTO_FILENAME_PATTERNS) {
    const match = base.match(pattern);
    if (!match?.groups) continue;
    return normalizeMeta(
      {
        input: filename,
        positionPair: match.groups.positionPair,
        line: match.groups.line.toUpperCase(),
        stackBb: match.groups.stackBb,
        flop: match.groups.flop,
      },
      process.cwd()
    );
  }
  return null;
}

function loadManifest(manifestPath) {
  const absolute = path.resolve(manifestPath);
  const raw = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`Manifest must be a JSON array: ${absolute}`);
  }
  const baseDir = path.dirname(absolute);
  return raw.map((entry) => normalizeMeta(entry, baseDir));
}

function discoverJobs(inputDir) {
  const absoluteDir = path.resolve(inputDir);
  const jobs = [];
  const skipped = [];

  for (const name of fs.readdirSync(absoluteDir)) {
    if (!name.endsWith('.json')) continue;
    const parsed = parseRawSolverFilename(path.join(absoluteDir, name));
    if (parsed) jobs.push(parsed);
    else skipped.push(name);
  }

  return { jobs, skipped };
}

function buildOutputPath(job, outputDir) {
  return path.join(
    path.resolve(outputDir),
    job.positionPair,
    `${job.line}_${job.stackBb}bb`,
    `flop_${job.flop}.json`
  );
}

function importSolverTree(job, outputDir) {
  const raw = JSON.parse(fs.readFileSync(job.input, 'utf8'));
  const normalized = normalizeSolverTree(raw);
  const outputPath = buildOutputPath(job, outputDir);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(normalized, null, 2)}\n`);

  return {
    job,
    outputPath,
    flopNodes: Object.keys(normalized.nodes || {}).length,
    turnBoards: Object.keys(normalized.turn || {}).length,
    riverBoards: Object.keys(normalized.river || {}).length,
  };
}

module.exports = {
  buildOutputPath,
  discoverJobs,
  importSolverTree,
  loadManifest,
  normalizeMeta,
  parseRawSolverFilename,
};
