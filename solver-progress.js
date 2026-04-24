const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function hasOutput(baseDir, job) {
  return fs.existsSync(
    path.join(
      path.resolve(baseDir),
      job.positionPair,
      `${job.line}_${job.stackBb}bb`,
      `flop_${job.flop}.json`
    )
  );
}

function summarizeManifest(manifestPath, rawDir, runtimeDir) {
  const jobs = readJson(manifestPath);
  const rawCount = jobs.filter((job) => hasOutput(rawDir, job)).length;
  const runtimeCount = jobs.filter((job) => hasOutput(runtimeDir, job)).length;

  return {
    manifestPath: path.resolve(manifestPath),
    count: jobs.length,
    rawCount,
    runtimeCount,
    pendingRawCount: jobs.length - rawCount,
    pendingRuntimeCount: jobs.length - runtimeCount,
    fullySolved: rawCount === jobs.length,
    fullyImported: runtimeCount === jobs.length,
  };
}

function summarizeWorkload({ indexPath, rawDir, runtimeDir }) {
  const index = readJson(indexPath);
  const manifests = index.manifests.map((entry) =>
    summarizeManifest(entry.path, rawDir, runtimeDir)
  );

  return {
    indexPath: path.resolve(indexPath),
    rawDir: path.resolve(rawDir),
    runtimeDir: path.resolve(runtimeDir),
    spot: index.spot,
    totalJobs: index.totalJobs,
    totalChunks: index.totalChunks,
    rawCount: manifests.reduce((sum, entry) => sum + entry.rawCount, 0),
    runtimeCount: manifests.reduce((sum, entry) => sum + entry.runtimeCount, 0),
    pendingRawCount: manifests.reduce((sum, entry) => sum + entry.pendingRawCount, 0),
    pendingRuntimeCount: manifests.reduce((sum, entry) => sum + entry.pendingRuntimeCount, 0),
    solvedChunks: manifests.filter((entry) => entry.fullySolved).length,
    importedChunks: manifests.filter((entry) => entry.fullyImported).length,
    manifests,
  };
}

module.exports = {
  hasOutput,
  summarizeManifest,
  summarizeWorkload,
};
