const DEFAULT_ACTION_UNIVERSE = [
  'fold',
  'check',
  'call',
  'bet_33',
  'bet_75',
  'bet_130',
  'raise_250',
  'raise_400',
  'allin',
];

const DEFAULT_TIMEOUT_MS = 800;

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(new Error('ETIMEDOUT')), timeoutMs);
  if (handle.unref) handle.unref();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(handle);
    },
  };
}

function normalizePolicy(policy, legalActions = []) {
  if (!policy || typeof policy !== 'object') return null;
  const allowed = new Set((legalActions || []).length > 0 ? legalActions : DEFAULT_ACTION_UNIVERSE);
  const entries = Object.entries(policy).filter(
    ([action, value]) =>
      allowed.has(action) && typeof value === 'number' && Number.isFinite(value) && value > 0
  );
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return null;
  return Object.fromEntries(entries.map(([action, value]) => [action, value / total]));
}

function validateModelResponse(response, legalActions = []) {
  if (!response || typeof response !== 'object') {
    return { ok: false, reason: 'invalid_response_shape' };
  }
  const normalizedPolicy = normalizePolicy(response.policy, legalActions);
  if (!normalizedPolicy) {
    return { ok: false, reason: 'invalid_policy' };
  }
  const confidence = Number.isFinite(response.confidence) ? Math.max(0, Math.min(1, response.confidence)) : 0;
  return {
    ok: true,
    selectedAction: typeof response.selectedAction === 'string' ? response.selectedAction : null,
    normalizedPolicy,
    confidence,
    modelVersion: response.modelVersion || 'unknown',
    coverageStatus: response.coverageStatus || null,
    latencyMs: Number.isFinite(response.latencyMs) ? response.latencyMs : null,
  };
}

async function postJson({ url, path, body, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = global.fetch }) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch_unavailable');
  }
  const { signal, dispose } = createTimeoutSignal(timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(new URL(path, url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal,
    });
    const json = await response.json();
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }
    return {
      ...json,
      latencyMs: Number.isFinite(json?.latencyMs) ? json.latencyMs : Date.now() - startedAt,
    };
  } catch (error) {
    if (signal.aborted) {
      const timeoutError = new Error('ETIMEDOUT');
      timeoutError.code = 'ETIMEDOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    dispose();
  }
}

async function checkModelService({
  url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = global.fetch,
}) {
  return postJson({
    url,
    path: '/health',
    body: {},
    timeoutMs,
    fetchImpl,
  });
}

async function requestModelDecision({
  url,
  payload,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = global.fetch,
}) {
  return postJson({
    url,
    path: '/decide',
    body: payload,
    timeoutMs,
    fetchImpl,
  });
}

module.exports = {
  DEFAULT_ACTION_UNIVERSE,
  DEFAULT_TIMEOUT_MS,
  checkModelService,
  normalizePolicy,
  requestModelDecision,
  validateModelResponse,
};
