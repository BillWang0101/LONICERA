const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildOutputPath,
  discoverJobs,
  importSolverTree,
  loadManifest,
  parseRawSolverFilename,
} = require('../solver-import');

function makeRawTree() {
  return {
    node_type: 'action_node',
    player: 1,
    strategy: {
      actions: ['CHECK', 'BET 33.000000'],
      strategy: {
        AsKd: [0.25, 0.75],
      },
    },
  };
}

describe('solver import helpers', () => {
  test('parses supported raw solver filename conventions', () => {
    expect(parseRawSolverFilename('BTN_vs_BB__SRP__50bb__As7h2d.json')).toMatchObject({
      positionPair: 'BTN_vs_BB',
      line: 'SRP',
      stackBb: 50,
      flop: 'As7h2d',
    });

    expect(parseRawSolverFilename('BTN_vs_BB_SRP_100bb_As7h2d.json')).toMatchObject({
      positionPair: 'BTN_vs_BB',
      line: 'SRP',
      stackBb: 100,
      flop: 'As7h2d',
    });
  });

  test('discovers auto-importable jobs and skips unknown filenames', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-import-discover-'));
    fs.writeFileSync(path.join(dir, 'BTN_vs_BB__SRP__50bb__As7h2d.json'), '{}');
    fs.writeFileSync(path.join(dir, 'notes.json'), '{}');

    const discovered = discoverJobs(dir);

    expect(discovered.jobs).toHaveLength(1);
    expect(discovered.skipped).toEqual(['notes.json']);
  });

  test('loads manifest entries relative to the manifest directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-import-manifest-'));
    fs.writeFileSync(path.join(dir, 'raw.json'), '{}');
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify([
        {
          input: 'raw.json',
          positionPair: 'BTN_vs_BB',
          line: 'SRP',
          stackBb: 50,
          flop: 'As7h2d',
        },
      ])
    );

    const [job] = loadManifest(path.join(dir, 'manifest.json'));

    expect(job.input).toBe(path.join(dir, 'raw.json'));
    expect(job.stackBb).toBe(50);
  });

  test('imports a raw tree into normalized runtime layout', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-import-run-'));
    const rawPath = path.join(workDir, 'BTN_vs_BB__SRP__50bb__As7h2d.json');
    fs.writeFileSync(rawPath, JSON.stringify(makeRawTree()));

    const result = importSolverTree(
      {
        input: rawPath,
        positionPair: 'BTN_vs_BB',
        line: 'SRP',
        stackBb: 50,
        flop: 'As7h2d',
      },
      path.join(workDir, 'out')
    );

    expect(result.outputPath).toBe(
      buildOutputPath(
        {
          positionPair: 'BTN_vs_BB',
          line: 'SRP',
          stackBb: 50,
          flop: 'As7h2d',
        },
        path.join(workDir, 'out')
      )
    );
    expect(fs.existsSync(result.outputPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(result.outputPath, 'utf8'));
    expect(parsed.nodes.root.strategyByCombo.AsKd).toEqual({ check: 0.25, bet_33: 0.75 });
  });
});
