#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = { solverDir: process.env.TEXASSOLVER_DIR || '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--solver-dir' && argv[i + 1]) {
      args.solverDir = argv[i + 1];
      i++;
    }
  }
  return args;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const { solverDir } = parseArgs(process.argv.slice(2));
if (!solverDir) {
  fail('Usage: node scripts/solver-smoke.js --solver-dir /path/to/TexasSolver');
}

const solverBin = path.join(solverDir, 'console_solver');
const sampleInputPath = path.join(solverDir, 'resources', 'text', 'commandline_sample_input.txt');

if (!fs.existsSync(solverBin)) {
  fail(`Missing solver binary: ${solverBin}`);
}
if (!fs.existsSync(sampleInputPath)) {
  fail(`Missing sample input: ${sampleInputPath}`);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lonicera-solver-smoke-'));
const outputPath = path.join(tempDir, 'solver-output.json');
let input = fs.readFileSync(sampleInputPath, 'utf8');

input = input.replace(/set_max_iteration\s+\d+/g, 'set_max_iteration 50');
if (/dump_result\s+/m.test(input)) {
  input = input.replace(/dump_result\s+.+/m, `dump_result ${outputPath}`);
} else {
  input += `\ndump_result ${outputPath}\n`;
}

const result = spawnSync(solverBin, [], {
  cwd: solverDir,
  input,
  encoding: 'utf8',
  timeout: 30000,
  maxBuffer: 16 * 1024 * 1024,
});

if (result.error) {
  fail(`Solver launch failed: ${result.error.message}`);
}

if (!fs.existsSync(outputPath)) {
  const stderr = (result.stderr || '').trim();
  const stdout = (result.stdout || '').trim();
  fail(
    `Solver did not produce output within 30s.\nstdout: ${stdout || '<empty>'}\nstderr: ${stderr || '<empty>'}`
  );
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
} catch (error) {
  fail(`Solver output is not valid JSON: ${error.message}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      solverDir,
      outputPath,
      nodeCount: Object.keys(parsed).length,
    },
    null,
    2
  )
);
