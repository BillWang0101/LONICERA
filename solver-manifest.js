const fs = require('fs');
const path = require('path');

const SCRIPT_FILENAME_PATTERNS = [
  /^(?<positionPair>[A-Z]+_vs_[A-Z]+)__(?<line>SRP|3BP)__(?<stackBb>\d+)bb__(?<flop>[2-9TJQKA][shdc][2-9TJQKA][shdc][2-9TJQKA][shdc])\.txt$/i,
  /^(?<positionPair>[A-Z]+_vs_[A-Z]+)_(?<line>SRP|3BP)_(?<stackBb>\d+)bb_(?<flop>[2-9TJQKA][shdc][2-9TJQKA][shdc][2-9TJQKA][shdc])\.txt$/i,
];

function parseSolveScriptFilename(filename) {
  const base = path.basename(filename);
  for (const pattern of SCRIPT_FILENAME_PATTERNS) {
    const match = base.match(pattern);
    if (!match?.groups) continue;
    return {
      inputScript: path.resolve(filename),
      positionPair: match.groups.positionPair,
      line: match.groups.line.toUpperCase(),
      stackBb: Number(match.groups.stackBb),
      flop: match.groups.flop,
    };
  }
  return null;
}

function discoverSolveScripts(inputDir) {
  const absoluteDir = path.resolve(inputDir);
  const entries = fs.readdirSync(absoluteDir);
  const jobs = [];
  const skipped = [];

  for (const name of entries) {
    if (!name.endsWith('.txt')) continue;
    const parsed = parseSolveScriptFilename(path.join(absoluteDir, name));
    if (parsed) jobs.push(parsed);
    else skipped.push(name);
  }

  return { jobs, skipped };
}

module.exports = {
  discoverSolveScripts,
  parseSolveScriptFilename,
};
