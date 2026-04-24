const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeRequestedFlops,
  renderSolverScript,
  resolveTreeProfile,
  resolveTargetFlops,
  scoreFlopDifficulty,
  selectAdaptiveTreeProfile,
  writeSolverScripts,
} = require('../solver-script-generator');

function createFakeSolverDir(rootDir) {
  const solverDir = path.join(rootDir, 'solver');
  const rangeDir = path.join(solverDir, 'ranges', '6max_range', 'BTN', '2.5bb', 'BB', 'Call');
  fs.mkdirSync(rangeDir, { recursive: true });
  fs.writeFileSync(path.join(rangeDir, 'BTN_range.txt'), 'AA:1.0');
  fs.writeFileSync(path.join(rangeDir, 'BB_range.txt'), 'KK:1.0');
  return solverDir;
}

describe('solver script generator', () => {
  test('normalizes requested flops onto canonical keys', () => {
    expect(normalizeRequestedFlops(['Ac7d2h', 'As7h2d'])).toEqual(['As7h2d']);
  });

  test('limits canonical flop generation', () => {
    expect(resolveTargetFlops({ limit: 3 })).toHaveLength(3);
  });

  test('renders a runnable script with tree-building commands', () => {
    const script = renderSolverScript({
      board: ['As', '7h', '2d'],
      ipRange: 'AA:1.0',
      oopRange: 'KK:1.0',
      pot: 100,
      effectiveStack: 950,
    });

    expect(script).toContain('set_pot 100');
    expect(script).toContain('set_effective_stack 950');
    expect(script).toContain('set_board As,7h,2d');
    expect(script).toContain('set_bet_sizes oop,flop,bet,33,75,130');
    expect(script).toContain('dump_result output_result.json');
    expect(script).not.toContain('set_raise_limit');
  });

  test('supports a lightweight benchmark tree profile', () => {
    const script = renderSolverScript({
      board: ['As', '7h', '2d'],
      ipRange: 'AA:1.0',
      oopRange: 'KK:1.0',
      pot: 100,
      effectiveStack: 950,
      treeProfile: 'benchmark',
    });

    expect(script).toContain('set_bet_sizes oop,flop,bet,75');
    expect(script).not.toContain('set_bet_sizes oop,flop,bet,33,75,130');
  });

  test('supports a recovery tree profile for retry passes', () => {
    const script = renderSolverScript({
      board: ['As', '7h', '2d'],
      ipRange: 'AA:1.0',
      oopRange: 'KK:1.0',
      pot: 100,
      effectiveStack: 950,
      treeProfile: 'recovery',
    });

    expect(resolveTreeProfile('recovery').name).toBe('recovery');
    expect(script).toContain('set_bet_sizes oop,flop,bet,50,100');
    expect(script).toContain('set_bet_sizes oop,turn,bet,66,125');
    expect(script).toContain('set_bet_sizes oop,river,bet,75,150');
  });

  test('scores low connected flops as harder than broadway-high dry flops', () => {
    const easy = scoreFlopDifficulty(['As', 'Kd', '8h']);
    const hard = scoreFlopDifficulty(['6s', '5h', '4d']);

    expect(hard.score).toBeGreaterThan(easy.score);
    expect(selectAdaptiveTreeProfile(['As', 'Kd', '8h']).treeProfile).toBe('full');
    expect(selectAdaptiveTreeProfile(['7s', '5h', '4d']).treeProfile).toBe('terminal_tail');
  });

  test('exact board overrides downgrade known bad boards before adaptive bands', () => {
    const decision = selectAdaptiveTreeProfile(['As', '5h', '3d']);

    expect(decision.treeProfile).toBe('recovery');
    expect(decision.profileSource).toBe('exact_override');
    expect(decision.overrideRuleId).toBe('exact_As5h3d');
  });

  test('terminal tail exact overrides exclude boards after repeated recovery failure', () => {
    const decision = selectAdaptiveTreeProfile(['As', '5h', '2d']);

    expect(decision.treeProfile).toBe('terminal_tail');
    expect(decision.profileSource).toBe('exact_override');
    expect(decision.overrideRuleId).toBe('exact_As5h2d');
  });

  test('writes canonical solve scripts and an optional manifest', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-script-generator-'));
    const outputDir = path.join(workDir, 'scripts');
    const manifestPath = path.join(workDir, 'solve-manifest.json');
    const solverDir = createFakeSolverDir(workDir);

    const result = writeSolverScripts({
      solverDir,
      outputDir,
      manifestPath,
      positionPair: 'BTN_vs_BB',
      line: 'SRP',
      stackBb: 50,
      flops: ['Ac7d2h'],
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].flop).toBe('As7h2d');
    expect(fs.existsSync(result.jobs[0].inputScript)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest).toHaveLength(1);
    expect(path.basename(manifest[0].inputScript)).toBe('BTN_vs_BB__SRP__50bb__As7h2d.txt');
  });

  test('adaptive script generation assigns lighter profiles to harder flops', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-script-generator-adaptive-'));
    const outputDir = path.join(workDir, 'scripts');
    const solverDir = createFakeSolverDir(workDir);

    const result = writeSolverScripts({
      solverDir,
      outputDir,
      positionPair: 'BTN_vs_BB',
      line: 'SRP',
      stackBb: 50,
      treeProfile: 'adaptive',
      flops: ['AsKd8h', 'As5h3d', 'As5h2d', '7s5h4d'],
    });

    const fullJob = result.jobs.find((job) => job.treeProfile === 'full');
    const downgradedJob = result.jobs.find((job) => job.flop === 'As5h3d');
    expect(fullJob).toBeTruthy();
    expect(downgradedJob.treeProfile).toBe('recovery');
    expect(downgradedJob.profileSource).toBe('exact_override');
    expect(result.excludedJobs.map((job) => job.flop)).toEqual(['7s5h4d', 'As5h2d']);
  });
});
