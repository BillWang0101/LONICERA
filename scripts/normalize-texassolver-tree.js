#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { normalizeSolverTree } = require('../solver-normalize');

function usage() {
  console.error('Usage: node scripts/normalize-texassolver-tree.js <input.json> <output.json>');
  process.exit(1);
}

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) usage();

const absoluteInput = path.resolve(inputPath);
const absoluteOutput = path.resolve(outputPath);

const raw = JSON.parse(fs.readFileSync(absoluteInput, 'utf8'));
const normalized = normalizeSolverTree(raw);

fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
fs.writeFileSync(absoluteOutput, `${JSON.stringify(normalized, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      ok: true,
      input: absoluteInput,
      output: absoluteOutput,
      flopNodes: Object.keys(normalized.nodes || {}).length,
      turnBoards: Object.keys(normalized.turn || {}).length,
      riverBoards: Object.keys(normalized.river || {}).length,
    },
    null,
    2
  )
);
