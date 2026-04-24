# Solver Data Layout

This repository only tracks solver integration code and deployment notes.

Large solver artifacts do **not** belong in Git:

- raw solver exports
- full runtime trees
- generated reports
- retry-recovery output
- one-off final script directories

Current validated deployment target:

- spot: `BTN_vs_BB / SRP / 50bb`
- status: `1755 / 1755` complete
- runtime lookup: verified

Runtime code should see the mounted tree through this in-repo path:

`data/solver/trees/BTN_vs_BB/SRP_50bb`

Recommended Docker Compose setup:

```bash
export SOLVER_DATA_DIR=/path/to/lonicera/solver-workloads/phase1-btn-vs-bb-srp-50bb-full/runtime
export SOLVER_ROOT_CACHE_DIR=/path/to/lonicera/solver-workloads/phase1-btn-vs-bb-srp-50bb-full/root-runtime-cache
docker compose up -d --build
```

`SOLVER_DATA_DIR` should point to the runtime root that contains `BTN_vs_BB/SRP_50bb`. `SOLVER_ROOT_CACHE_DIR` is optional but recommended for fast root-cache exact-hit lookup.

Runtime lookup expects normalized JSON trees under:

`data/solver/trees/<POSITION_PAIR>/<LINE>_<STACK>bb/flop_<FLOP>.json`

Example:

`data/solver/trees/BTN_vs_BB/SRP_50bb/flop_As7h2d.json`

The current runtime supports:

- `version: 2` normalized trees produced by `scripts/normalize-texassolver-tree.js`
- `flop` nodes in `nodes`
- optional `turn` nodes keyed by turn card, for example `turn["2c"]`
- optional `river` nodes keyed by `turn|river`, for example `river["2c|Ah"]`

Useful commands:

```bash
npm run solver:smoke -- --solver-dir "/path/to/TexasSolver-v0.2.0-MacOs"
npm run solver:generate-scripts -- \
  --solver-dir "/path/to/TexasSolver-v0.2.0-MacOs" \
  --output-dir solver_scripts \
  --position-pair BTN_vs_BB \
  --line SRP \
  --stack-bb 50 \
  --tree-profile benchmark \
  --manifest solve-manifest.json
npm run solver:prepare-phase1 -- \
  --solver-dir "/path/to/TexasSolver-v0.2.0-MacOs" \
  --output-root solver_phase1 \
  --position-pair BTN_vs_BB \
  --line SRP \
  --stack-bb 50 \
  --tree-profile full \
  --chunk-size 25
npm run solver:report-workload -- \
  --index solver_phase1/workload-index.json
npm run solver:run-workload -- \
  --index solver_phase1/workload-index.json \
  --solver-dir "/path/to/TexasSolver-v0.2.0-MacOs" \
  --start-part 1 \
  --max-parts 2 \
  --max-iteration 10 \
  --timeout-ms 180000
npm run solver:manifest -- --input-dir solver_scripts --output solve-manifest.json
npm run solver:normalize -- raw.json normalized.json
node scripts/import-texassolver-tree.js \
  --input raw.json \
  --position-pair BTN_vs_BB \
  --line SRP \
  --stack-bb 50 \
  --flop As7h2d

node scripts/import-texassolver-batch.js \
  --input-dir raw_output_dir

node scripts/import-texassolver-batch.js \
  --manifest imports.json

node scripts/run-texassolver-batch.js \
  --solver-dir "/path/to/TexasSolver-v0.2.0-MacOs" \
  --manifest solve-manifest.json \
  --skip-existing \
  --continue-on-error \
  --import
```

Notes:

- No data file means NPC falls back to the existing heuristic engine.
- The current spot inference is intentionally conservative and only enables solver play in supported heads-up postflop states.
- Runtime lookup canonicalizes suit-isomorphic boards and hole-card suits, so one canonical flop file can serve every equivalent suit permutation.
- `solver:generate-scripts` emits canonical flop scripts; without `--flops` it generates all 1755 flop classes for the requested spot.
- `--tree-profile benchmark` emits a much smaller tree for pipeline validation before running the default full tree profile offline.
- `solver:prepare-phase1` writes a workload directory with canonical scripts, chunked manifests, and an index file for resumable offline runs.
- `run-texassolver-batch` supports `--skip-existing` and `--continue-on-error` for long jobs.
- `solver:report-workload` summarizes how many manifests and flop trees have raw/runtime outputs already written.
- `solver:run-workload` runs selected manifest slices in sequence and writes one report file per part.
- Solve-script auto-discovery recognizes `.txt` filenames like `BTN_vs_BB__SRP__50bb__As7h2d.txt`.
- Auto-discovery recognizes filenames like `BTN_vs_BB__SRP__50bb__As7h2d.json` or `BTN_vs_BB_SRP_50bb_As7h2d.json`.
- Manifest mode expects a JSON array with `input`, `positionPair`, `line`, `stackBb`, and `flop`.
- Solve manifest mode expects `inputScript`, `positionPair`, `line`, `stackBb`, and `flop`.
