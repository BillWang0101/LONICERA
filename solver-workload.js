const fs = require('fs');
const path = require('path');
const { chunkJobs, writeSolverScripts } = require('./solver-script-generator');

function manifestFilename(index) {
  return `part-${String(index + 1).padStart(3, '0')}.json`;
}

function buildWorkloadIndex({ manifestsDir, jobs, chunks, chunkSize, config }) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    spot: {
      positionPair: config.positionPair,
      line: config.line,
      stackBb: config.stackBb,
      treeProfile: config.treeProfile,
    },
    totalJobs: jobs.length,
    chunkSize,
    totalChunks: chunks.length,
    manifests: chunks.map((chunk, index) => ({
      filename: manifestFilename(index),
      path: path.join(manifestsDir, manifestFilename(index)),
      count: chunk.length,
      firstFlop: chunk[0]?.flop || null,
      lastFlop: chunk[chunk.length - 1]?.flop || null,
    })),
  };
}

function writePhaseWorkload({
  solverDir,
  outputRoot,
  positionPair,
  line,
  stackBb,
  treeProfile = 'full',
  chunkSize = 25,
  flops,
  limit,
}) {
  const absoluteOutputRoot = path.resolve(outputRoot);
  const scriptsDir = path.join(absoluteOutputRoot, 'scripts');
  const manifestsDir = path.join(absoluteOutputRoot, 'manifests');
  const indexPath = path.join(absoluteOutputRoot, 'workload-index.json');

  fs.mkdirSync(absoluteOutputRoot, { recursive: true });
  fs.mkdirSync(manifestsDir, { recursive: true });

  const generated = writeSolverScripts({
    solverDir,
    outputDir: scriptsDir,
    positionPair,
    line,
    stackBb,
    treeProfile,
    flops,
    limit,
  });

  const chunks = chunkJobs(generated.jobs, chunkSize);
  for (let index = 0; index < chunks.length; index++) {
    const manifestPath = path.join(manifestsDir, manifestFilename(index));
    fs.writeFileSync(manifestPath, `${JSON.stringify(chunks[index], null, 2)}\n`);
  }

  const workloadIndex = buildWorkloadIndex({
    manifestsDir,
    jobs: generated.jobs,
    chunks,
    chunkSize,
    config: {
      positionPair,
      line,
      stackBb,
      treeProfile: generated.config.treeProfile,
    },
  });
  fs.writeFileSync(indexPath, `${JSON.stringify(workloadIndex, null, 2)}\n`);

  return {
    outputRoot: absoluteOutputRoot,
    scriptsDir,
    manifestsDir,
    indexPath,
    jobs: generated.jobs,
    chunks,
    workloadIndex,
    config: generated.config,
  };
}

module.exports = {
  buildWorkloadIndex,
  manifestFilename,
  writePhaseWorkload,
};
