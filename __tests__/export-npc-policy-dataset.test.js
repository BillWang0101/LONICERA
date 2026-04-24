const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  remapActionKeyToModelUniverse,
  remapStrategyToModelUniverse,
} = require('../scripts/export-npc-policy-dataset');

describe('export npc policy dataset script', () => {
  test('remaps oversized teacher bet sizes into model action buckets', () => {
    const gameState = {
      pot: 100,
      currentBet: 0,
      playerBet: 0,
      chips: 1000,
      minRaise: 20,
      phase: 'flop',
      activePlayers: 2,
      bigBlind: 20,
    };

    expect(remapActionKeyToModelUniverse('bet_950', gameState)).toBe('allin');
    expect(remapActionKeyToModelUniverse('bet_100', gameState)).toBe('bet_75');
    expect(remapActionKeyToModelUniverse('bet_50', gameState)).toBe('bet_33');
    expect(remapActionKeyToModelUniverse('bet_130', gameState)).toBe('bet_130');

    const remapped = remapStrategyToModelUniverse(
      {
        check: 0.2,
        bet_50: 0.3,
        bet_100: 0.1,
        bet_950: 0.4,
      },
      gameState
    );

    expect(remapped.strategy).toMatchObject({
      check: 0.2,
      bet_33: 0.3,
      bet_75: 0.1,
      allin: 0.4,
    });
    expect(remapped.remappedActionCount).toBe(3);
    expect(remapped.remappedMass).toBeCloseTo(0.8);
  });

  test('exports root flop policy samples with teacher metadata', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npc-policy-dataset-'));
    const dataDir = path.join(tmpDir, 'trees', 'BTN_vs_BB', 'SRP_50bb');
    const outputPath = path.join(tmpDir, 'dataset.jsonl');
    const summaryPath = path.join(tmpDir, 'dataset.summary.json');
    const manifestPath = path.join(tmpDir, 'manifest.json');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), '__tests__', 'fixtures', 'solver', 'BTN_vs_BB', 'SRP_50bb', 'flop_As7h2d.json'),
      path.join(dataDir, 'flop_AsKhJd.json')
    );
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify([{ flop: 'AsKhJd', treeProfile: 'full_lite' }], null, 2)}\n`
    );

    execFileSync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts', 'export-npc-policy-dataset.js'),
        '--output',
        outputPath,
        '--data-dir',
        path.join(tmpDir, 'trees'),
        '--manifest',
        manifestPath,
        '--summary-output',
        summaryPath,
      ],
      { cwd: process.cwd(), stdio: 'pipe' }
    );

    const rows = fs
      .readFileSync(outputPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      teacherSource: 'full_lite',
      confidence: 0.8,
      quality: 'full_lite',
      contextFeatures: {
        positionPair: 'BTN_vs_BB',
        preflopLine: 'SRP',
      },
    });
    expect(rows[0].legalActions).toEqual(expect.arrayContaining(['check', 'bet_75']));
    expect(rows[0].teacherPolicy.bet_950).toBeUndefined();
    expect(rows[0].teacherAlignment).toBeDefined();

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    expect(summary).toMatchObject({
      sampleCount: rows.length,
      minQuality: 'full_lite',
      samplesByTeacherSource: {
        full_lite: rows.length,
      },
    });
    expect(summary.teacherAlignment).toBeDefined();
    expect(summary.teacherAlignment.rowsWithRemappedActions).toBeGreaterThanOrEqual(0);
  });

  test('later manifests override earlier teacher quality for the same flop', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npc-policy-dataset-merge-'));
    const dataDir = path.join(tmpDir, 'trees', 'BTN_vs_BB', 'SRP_50bb');
    const outputPath = path.join(tmpDir, 'dataset.jsonl');
    const summaryPath = path.join(tmpDir, 'dataset.summary.json');
    const baseManifestPath = path.join(tmpDir, 'base-manifest.json');
    const overrideManifestPath = path.join(tmpDir, 'override-manifest.json');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), '__tests__', 'fixtures', 'solver', 'BTN_vs_BB', 'SRP_50bb', 'flop_As7h2d.json'),
      path.join(dataDir, 'flop_AsKhJd.json')
    );
    fs.writeFileSync(
      baseManifestPath,
      `${JSON.stringify([{ flop: 'AsKhJd', treeProfile: 'full_lite' }], null, 2)}\n`
    );
    fs.writeFileSync(
      overrideManifestPath,
      `${JSON.stringify([{ flop: 'AsKhJd', treeProfile: 'recovery' }], null, 2)}\n`
    );

    execFileSync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts', 'export-npc-policy-dataset.js'),
        '--output',
        outputPath,
        '--data-dir',
        path.join(tmpDir, 'trees'),
        '--manifest',
        `${baseManifestPath},${overrideManifestPath}`,
        '--summary-output',
        summaryPath,
        '--min-quality',
        'recovery',
      ],
      { cwd: process.cwd(), stdio: 'pipe' }
    );

    const rows = fs
      .readFileSync(outputPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      teacherSource: 'recovery',
      quality: 'recovery',
      confidence: 0.5,
    });

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    expect(summary.samplesByTeacherSource).toMatchObject({
      recovery: rows.length,
    });
  });
});
