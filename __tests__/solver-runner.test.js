const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  describeMissingOutput,
  inferSolverStage,
  loadSolveManifest,
  rewriteDumpResult,
  runSolverScript,
  stripUnsupportedCommands,
  trimSolverLog,
} = require('../solver-runner');

describe('solver runner helpers', () => {
  test('rewriteDumpResult replaces dump path and optionally max iterations', () => {
    const rewritten = rewriteDumpResult(
      'set_raise_limit 3\nset_max_iteration 500\ndump_result old.json\n',
      '/tmp/new.json',
      120
    );

    expect(rewritten).toContain('set_max_iteration 120');
    expect(rewritten).toContain('dump_result /tmp/new.json');
    expect(rewritten).not.toContain('old.json');
    expect(rewritten).not.toContain('set_raise_limit');
  });

  test('stripUnsupportedCommands removes solver-incompatible commands', () => {
    expect(stripUnsupportedCommands('set_raise_limit 3\nbuild_tree\n')).toBe('build_tree');
  });

  test('loadSolveManifest resolves inputScript relative to manifest file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-runner-manifest-'));
    fs.writeFileSync(path.join(dir, 'spot.txt'), 'build_tree');
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify([
        {
          inputScript: 'spot.txt',
          positionPair: 'BTN_vs_BB',
          line: 'SRP',
          stackBb: 50,
          flop: 'As7h2d',
        },
      ])
    );

    const [job] = loadSolveManifest(path.join(dir, 'manifest.json'));

    expect(job.inputScript).toBe(path.join(dir, 'spot.txt'));
    expect(job.positionPair).toBe('BTN_vs_BB');
    expect(job.line).toBe('SRP');
    expect(job.stackBb).toBe(50);
  });

  test('runSolverScript can skip an existing raw output', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-runner-skip-'));
    const inputScript = path.join(dir, 'spot.txt');
    const outputPath = path.join(dir, 'output.json');
    fs.writeFileSync(inputScript, 'dump_result old.json\n');
    fs.writeFileSync(outputPath, '{}');

    const result = await runSolverScript({
      solverDir: '/path/to/TexasSolver',
      inputScript,
      outputPath,
      skipExisting: true,
    });

    expect(result.skipped).toBe(true);
  });

  test('inferSolverStage classifies a solve that started but failed before dump', () => {
    expect(
      inferSolverStage({
        stdout: '...[#####] 100%\n<<<START SOLVING>>>\nUsing 8 threads\nIter: 0',
        stderr: '',
      })
    ).toBe('solve_started');
  });

  test('trimSolverLog keeps only the tail of very long logs', () => {
    const longText = `${'a'.repeat(4500)}tail`;
    const trimmed = trimSolverLog(longText, 20);

    expect(trimmed).toBe(`...${'a'.repeat(16)}tail`);
  });

  test('describeMissingOutput includes structured diagnostics', () => {
    const message = describeMissingOutput(
      '/tmp/out.json',
      '/tmp/debug/solver-input.txt',
      '/tmp/debug/solver-result.json',
      {
        code: 0,
        signal: null,
        stdout: '<<<START SOLVING>>>\nIter: 0',
        stderr: '',
      }
    );

    expect(message).toContain('Solver did not produce /tmp/out.json.');
    expect(message).toContain('exitCode=0 signal=<none> inferredStage=solve_started.');
    expect(message).toContain('Debug input saved to /tmp/debug/solver-input.txt.');
    expect(message).toContain('Debug metadata saved to /tmp/debug/solver-result.json.');
    expect(message).toContain('stdoutTail=<<<START SOLVING>>>');
    expect(message).toContain('stderrTail=<empty>');
  });
});
