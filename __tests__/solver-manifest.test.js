const fs = require('fs');
const os = require('os');
const path = require('path');
const { discoverSolveScripts, parseSolveScriptFilename } = require('../solver-manifest');

describe('solver manifest helpers', () => {
  test('parses supported solve-script filename conventions', () => {
    expect(parseSolveScriptFilename('BTN_vs_BB__SRP__50bb__As7h2d.txt')).toMatchObject({
      positionPair: 'BTN_vs_BB',
      line: 'SRP',
      stackBb: 50,
      flop: 'As7h2d',
    });

    expect(parseSolveScriptFilename('BTN_vs_BB_SRP_100bb_As7h2d.txt')).toMatchObject({
      positionPair: 'BTN_vs_BB',
      line: 'SRP',
      stackBb: 100,
      flop: 'As7h2d',
    });
  });

  test('discovers valid solve scripts and skips unrelated files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solve-manifest-discover-'));
    fs.writeFileSync(path.join(dir, 'BTN_vs_BB__SRP__50bb__As7h2d.txt'), 'build_tree');
    fs.writeFileSync(path.join(dir, 'README.txt'), 'note');

    const discovered = discoverSolveScripts(dir);

    expect(discovered.jobs).toHaveLength(1);
    expect(discovered.skipped).toEqual(['README.txt']);
  });
});
