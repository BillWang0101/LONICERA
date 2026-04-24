const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const UNSUPPORTED_COMMAND_PATTERNS = [/^set_raise_limit\s+.+$/gm];
const SOLVER_LOG_TAIL_LIMIT = 4000;

function stripUnsupportedCommands(inputText) {
  let next = String(inputText || '');
  for (const pattern of UNSUPPORTED_COMMAND_PATTERNS) {
    next = next.replace(pattern, '');
  }
  return next
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, rows) => !(line === '' && rows[index - 1] === ''))
    .join('\n')
    .trim();
}

function rewriteDumpResult(inputText, outputPath, maxIteration) {
  let next = stripUnsupportedCommands(inputText);
  if (typeof maxIteration === 'number' && Number.isFinite(maxIteration) && maxIteration > 0) {
    if (/set_max_iteration\s+\d+/m.test(next)) {
      next = next.replace(/set_max_iteration\s+\d+/m, `set_max_iteration ${Math.floor(maxIteration)}`);
    } else {
      next += `\nset_max_iteration ${Math.floor(maxIteration)}\n`;
    }
  }

  if (/dump_result\s+/m.test(next)) {
    next = next.replace(/dump_result\s+.+/m, `dump_result ${outputPath}`);
  } else {
    next += `\ndump_result ${outputPath}\n`;
  }

  return next;
}

function loadSolveManifest(manifestPath) {
  const absolute = path.resolve(manifestPath);
  const raw = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`Solve manifest must be a JSON array: ${absolute}`);
  }
  const baseDir = path.dirname(absolute);
  return raw.map((entry) => ({
    ...entry,
    inputScript: path.resolve(baseDir, entry.inputScript),
  }));
}

function trimSolverLog(text, limit = SOLVER_LOG_TAIL_LIMIT) {
  const normalized = String(text || '').trim();
  if (!normalized) return '<empty>';
  if (normalized.length <= limit) return normalized;
  return `...${normalized.slice(normalized.length - limit)}`;
}

function inferSolverStage(result) {
  const stdout = String(result?.stdout || '');
  const stderr = String(result?.stderr || '');

  if (stderr.trim()) return 'stderr_reported';
  if (stdout.includes('<<<START SOLVING>>>')) return 'solve_started';
  if (/\]\s*\d+%/.test(stdout)) return 'tree_building';
  if (stdout.trim()) return 'startup_or_tree_setup';
  return 'no_solver_output';
}

function describeMissingOutput(outputPath, debugInput, debugMeta, result) {
  const exitCode =
    typeof result?.code === 'number' ? result.code : result?.code === null ? '<null>' : '<unknown>';
  const signal = result?.signal || '<none>';
  const inferredStage = inferSolverStage(result);
  const stdoutTail = trimSolverLog(result?.stdout);
  const stderrTail = trimSolverLog(result?.stderr);

  return [
    `Solver did not produce ${outputPath}.`,
    `exitCode=${exitCode} signal=${signal} inferredStage=${inferredStage}.`,
    `Debug input saved to ${debugInput}.`,
    `Debug metadata saved to ${debugMeta}.`,
    `stdoutTail=${stdoutTail}`,
    `stderrTail=${stderrTail}`,
  ].join(' ');
}

function spawnSolver({
  solverBin,
  solverDir,
  input,
  timeoutMs,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(solverBin, [], {
      cwd: solverDir,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let settled = false;
    let stdout = '';
    let stderr = '';
    let killedForTimeout = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      fn(value);
    };

    const appendChunk = (target, chunk) => {
      const next = target + String(chunk || '');
      if (next.length > 16 * 1024 * 1024) {
        return next.slice(next.length - 16 * 1024 * 1024);
      }
      return next;
    };

    const killTree = (signal) => {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch (_) {
        // Fall back to the direct child when process groups are unavailable.
      }
      try {
        child.kill(signal);
      } catch (_) {
        // Ignore kill races.
      }
    };

    child.stdout.on('data', (chunk) => {
      stdout = appendChunk(stdout, chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr = appendChunk(stderr, chunk);
    });

    child.on('error', (error) => {
      settle(reject, error);
    });

    child.on('close', (code, signal) => {
      if (killedForTimeout) return;
      settle(resolve, {
        code,
        signal,
        stdout,
        stderr,
      });
    });

    const timeoutHandle = setTimeout(() => {
      killedForTimeout = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 1000);
      const error = new Error(`spawn /${path.basename(solverBin)} ETIMEDOUT`);
      error.code = 'ETIMEDOUT';
      error.stdout = stdout;
      error.stderr = stderr;
      settle(reject, error);
    }, timeoutMs);

    child.stdin.end(input);
  });
}

async function runSolverScript({
  solverDir,
  inputScript,
  outputPath,
  timeoutMs = 300000,
  maxIteration,
  skipExisting = false,
}) {
  if (skipExisting && fs.existsSync(outputPath)) {
    return {
      outputPath,
      stdout: '',
      stderr: '',
      skipped: true,
    };
  }

  const absoluteSolverDir = path.resolve(solverDir);
  const solverBin = path.join(absoluteSolverDir, 'console_solver');
  const inputText = fs.readFileSync(path.resolve(inputScript), 'utf8');
  const rewritten = rewriteDumpResult(inputText, outputPath, maxIteration);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const attemptTimeouts = [timeoutMs, Math.max(timeoutMs * 2, timeoutMs + 120000)];
  let result = null;

  for (let index = 0; index < attemptTimeouts.length; index++) {
    try {
      result = await spawnSolver({
        solverBin,
        solverDir: absoluteSolverDir,
        input: rewritten,
        timeoutMs: attemptTimeouts[index],
      });
      break;
    } catch (error) {
      const canRetry = error && error.code === 'ETIMEDOUT' && index < attemptTimeouts.length - 1;
      if (!canRetry) {
        throw error;
      }
      result = {
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        code: null,
        signal: 'SIGKILL',
      };
    }
  }

  if (!result) {
    throw new Error(`Solver did not return a result for ${inputScript}`);
  }

  if (!fs.existsSync(outputPath)) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lonicera-solver-failed-'));
    const debugInput = path.join(tempDir, 'solver-input.txt');
    const debugMeta = path.join(tempDir, 'solver-result.json');
    fs.writeFileSync(debugInput, rewritten);
    fs.writeFileSync(
      debugMeta,
      `${JSON.stringify(
        {
          outputPath,
          exitCode: typeof result.code === 'number' ? result.code : null,
          signal: result.signal || null,
          inferredStage: inferSolverStage(result),
          stdoutTail: trimSolverLog(result.stdout),
          stderrTail: trimSolverLog(result.stderr),
        },
        null,
        2
      )}\n`
    );
    throw new Error(describeMissingOutput(outputPath, debugInput, debugMeta, result));
  }

  return {
    outputPath,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    skipped: false,
  };
}

module.exports = {
  describeMissingOutput,
  inferSolverStage,
  loadSolveManifest,
  rewriteDumpResult,
  runSolverScript,
  stripUnsupportedCommands,
  trimSolverLog,
};
