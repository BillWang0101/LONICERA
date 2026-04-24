const fs = require('fs');
const os = require('os');
const path = require('path');
const { summarizeWorkload } = require('../solver-progress');

describe('solver progress helpers', () => {
  test('summarizes raw and runtime completion across workload manifests', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-progress-'));
    const manifestsDir = path.join(workDir, 'manifests');
    const rawDir = path.join(workDir, 'raw');
    const runtimeDir = path.join(workDir, 'runtime');
    fs.mkdirSync(manifestsDir, { recursive: true });

    const jobs = [
      {
        inputScript: '/tmp/a.txt',
        positionPair: 'BTN_vs_BB',
        line: 'SRP',
        stackBb: 50,
        flop: 'As7h2d',
      },
      {
        inputScript: '/tmp/b.txt',
        positionPair: 'BTN_vs_BB',
        line: 'SRP',
        stackBb: 50,
        flop: 'Ks7h2d',
      },
    ];

    const manifestPath = path.join(manifestsDir, 'part-001.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(jobs, null, 2)}\n`);
    fs.writeFileSync(
      path.join(workDir, 'workload-index.json'),
      `${JSON.stringify({
        totalJobs: 2,
        totalChunks: 1,
        spot: {
          positionPair: 'BTN_vs_BB',
          line: 'SRP',
          stackBb: 50,
          treeProfile: 'benchmark',
        },
        manifests: [{ path: manifestPath }],
      })}\n`
    );

    fs.mkdirSync(path.join(rawDir, 'BTN_vs_BB', 'SRP_50bb'), { recursive: true });
    fs.mkdirSync(path.join(runtimeDir, 'BTN_vs_BB', 'SRP_50bb'), { recursive: true });
    fs.writeFileSync(
      path.join(rawDir, 'BTN_vs_BB', 'SRP_50bb', 'flop_As7h2d.json'),
      '{}'
    );
    fs.writeFileSync(
      path.join(runtimeDir, 'BTN_vs_BB', 'SRP_50bb', 'flop_As7h2d.json'),
      '{}'
    );

    const summary = summarizeWorkload({
      indexPath: path.join(workDir, 'workload-index.json'),
      rawDir,
      runtimeDir,
    });

    expect(summary.rawCount).toBe(1);
    expect(summary.runtimeCount).toBe(1);
    expect(summary.pendingRawCount).toBe(1);
    expect(summary.manifests[0].fullySolved).toBe(false);
    expect(summary.manifests[0].fullyImported).toBe(false);
  });
});
