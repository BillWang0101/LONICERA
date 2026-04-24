const fs = require('fs');
const path = require('path');
const { buildRootOnlyTreePayload } = require('../solver-lookup');

function parseArgs(argv) {
  const args = {
    dataDir: process.env.SOLVER_DATA_DIR || '',
    rootCacheDir: process.env.SOLVER_ROOT_CACHE_DIR || '',
    limit: Infinity,
    overwrite: false,
    concurrency: 3,
    progressEvery: 25,
  };

  for (let index = 2; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--data-dir') {
      args.dataDir = argv[++index];
    } else if (token === '--root-cache-dir') {
      args.rootCacheDir = argv[++index];
    } else if (token === '--limit') {
      const value = Number(argv[++index]);
      args.limit = Number.isFinite(value) && value > 0 ? value : Infinity;
    } else if (token === '--concurrency') {
      const value = Number(argv[++index]);
      args.concurrency = Number.isFinite(value) && value > 0 ? Math.min(8, Math.floor(value)) : args.concurrency;
    } else if (token === '--progress-every') {
      const value = Number(argv[++index]);
      args.progressEvery =
        Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : args.progressEvery;
    } else if (token === '--overwrite') {
      args.overwrite = true;
    }
  }

  return args;
}

function listFlopFiles(rootDir) {
  const results = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (/^flop_[2-9TJQKA][shdc][2-9TJQKA][shdc][2-9TJQKA][shdc]\.json$/i.test(entry.name)) {
        results.push(entryPath);
      }
    }
  }

  walk(rootDir);
  return results.sort();
}

function parseFlopCodesFromPath(filePath) {
  const match = path.basename(filePath).match(
    /^flop_([2-9TJQKA][shdc])([2-9TJQKA][shdc])([2-9TJQKA][shdc])\.json$/i
  );
  if (!match) return [];
  return [match[1], match[2], match[3]];
}

function estimateCanonicalFlopWeight(filePath) {
  const cards = parseFlopCodesFromPath(filePath);
  if (cards.length !== 3) return 1;
  const ranks = cards.map((card) => card[0]);
  const suits = cards.map((card) => card[1]);
  const rankCounts = Object.values(
    ranks.reduce((acc, rank) => {
      acc[rank] = (acc[rank] || 0) + 1;
      return acc;
    }, {})
  ).sort((left, right) => right - left);
  const uniqueSuits = new Set(suits).size;

  if (rankCounts[0] === 3) return 4;
  if (rankCounts[0] === 2) {
    return 12;
  }
  if (uniqueSuits === 1) return 4;
  if (uniqueSuits === 2) return 36;
  return 24;
}

function buildPriorityQueue({ dataDir, rootCacheDir, overwrite }) {
  const files = listFlopFiles(dataDir);
  const pending = [];
  let skipped = 0;

  for (const fullFilePath of files) {
    const relativePath = path.relative(dataDir, fullFilePath);
    const targetPath = path.join(rootCacheDir, relativePath);
    if (!overwrite && fs.existsSync(targetPath)) {
      skipped++;
      continue;
    }

    const sourceSize = fs.statSync(fullFilePath).size;
    const canonicalWeight = estimateCanonicalFlopWeight(fullFilePath);
    const density = canonicalWeight / Math.max(1, sourceSize);
    pending.push({
      fullFilePath,
      relativePath,
      targetPath,
      sourceSize,
      canonicalWeight,
      density,
    });
  }

  pending.sort((left, right) => {
    if (right.density !== left.density) return right.density - left.density;
    if (right.canonicalWeight !== left.canonicalWeight) return right.canonicalWeight - left.canonicalWeight;
    if (left.sourceSize !== right.sourceSize) return left.sourceSize - right.sourceSize;
    return left.relativePath.localeCompare(right.relativePath);
  });

  return { pending, skipped };
}

function formatEta(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h${minutes}m${seconds}s`;
}

async function buildRootCacheFile({ fullFilePath, targetPath }) {
  const raw = await fs.promises.readFile(fullFilePath, 'utf8');
  const tree = JSON.parse(raw);
  const rootPayload = buildRootOnlyTreePayload(tree);
  if (!rootPayload) {
    throw new Error(`root node missing for ${fullFilePath}`);
  }
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.promises.writeFile(tempPath, JSON.stringify(rootPayload), 'utf8');
    await fs.promises.rename(tempPath, targetPath);
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => null);
    throw error;
  }
}

async function main() {
  const { dataDir, rootCacheDir, limit, overwrite, concurrency, progressEvery } = parseArgs(process.argv);
  if (!dataDir) throw new Error('missing --data-dir');
  if (!rootCacheDir) throw new Error('missing --root-cache-dir');
  if (!fs.existsSync(dataDir)) throw new Error(`runtime dir not found: ${dataDir}`);

  const { pending: rawPending, skipped } = buildPriorityQueue({ dataDir, rootCacheDir, overwrite });
  const pending = rawPending.slice(0, limit);
  const total = pending.length;
  const startedAt = Date.now();

  let processed = 0;
  let written = 0;
  let failed = 0;
  let nextIndex = 0;
  let lastLogged = 0;
  const failures = [];

  const logProgress = (force = false, lastFile = null) => {
    if (!force && processed - lastLogged < progressEvery) return;
    lastLogged = processed;
    const elapsedMs = Date.now() - startedAt;
    const perItemMs = processed > 0 ? elapsedMs / processed : 0;
    const remaining = Math.max(0, total - processed);
    const etaMs = perItemMs * remaining;
    console.error(
      JSON.stringify({
        processed,
        total,
        written,
        failed,
        skipped,
        concurrency,
        elapsedMs,
        eta: formatEta(etaMs),
        lastFile,
      })
    );
  };

  async function worker(workerId) {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex++;
      if (currentIndex >= total) return;

      const entry = pending[currentIndex];
      try {
        await buildRootCacheFile(entry);
        written++;
      } catch (error) {
        failed++;
        failures.push({
          file: entry.relativePath,
          error: error.message || String(error),
          workerId,
        });
      } finally {
        processed++;
        logProgress(false, entry.relativePath);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, total || 1)) }, (_, index) =>
      worker(index)
    )
  );

  logProgress(true, pending[Math.max(0, Math.min(pending.length - 1, processed - 1))]?.relativePath || null);

  console.log(
    JSON.stringify(
      {
        ok: failed === 0,
        dataDir,
        rootCacheDir,
        total,
        processed,
        written,
        failed,
        skipped,
        concurrency,
        failures: failures.slice(0, 20),
      },
      null,
      2
    )
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message || String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
