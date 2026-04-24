const SOLVER_ENABLED_NPCS = new Set(['诸葛亮', '赵云', '韩信', '吴用', '王熙凤', '奥德修斯', '刘邦']);

const DEVIATION_PROFILES = {
  诸葛亮: { foldShift: -0.03, bluffShift: 0.05, aggressionShift: 0.04 },
  赵云: { foldShift: 0.0, bluffShift: 0.0, aggressionShift: 0.0 },
  韩信: { foldShift: 0.02, bluffShift: -0.02, aggressionShift: 0.02 },
  吴用: { foldShift: -0.05, bluffShift: 0.06, aggressionShift: 0.02 },
  王熙凤: { foldShift: -0.04, bluffShift: 0.04, aggressionShift: 0.05 },
  奥德修斯: { foldShift: -0.03, bluffShift: 0.05, aggressionShift: 0.03 },
  刘邦: { foldShift: -0.02, bluffShift: 0.03, aggressionShift: 0.02 },
};

function isSolverEligibleProfile(profile) {
  if (!profile || !profile.name) return false;
  if (SOLVER_ENABLED_NPCS.has(profile.name)) return true;

  // All checked-in character profiles carry display metadata such as nameEn/origin/title.
  // They can safely consume the same exact solver policy; persona-specific behavior remains
  // a bounded probability deviation after the baseline policy is loaded.
  return !!(profile.nameEn || profile.origin || profile.title || profile.isWestern);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function isAggressiveAction(action) {
  return (
    action === 'allin' ||
    action.startsWith('bet_') ||
    action.startsWith('raise_')
  );
}

function normalize(strategy) {
  const entries = Object.entries(strategy).filter(
    ([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0
  );
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return null;
  return Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
}

function capShiftedProbability(baseValue, shiftedValue, maxShift) {
  if (!Number.isFinite(baseValue)) return clamp01(shiftedValue);
  const cap = Math.max(0, Number(maxShift) || 0);
  return clamp01(Math.max(baseValue - cap, Math.min(baseValue + cap, shiftedValue)));
}

function filterAllowedActions(strategy, allowedActions) {
  if (!Array.isArray(allowedActions) || allowedActions.length === 0) return { ...strategy };
  const allowed = new Set(allowedActions);
  return Object.fromEntries(Object.entries(strategy).filter(([action]) => allowed.has(action)));
}

function applyPersonaDeviation(strategy, profile, psych = {}, options = {}) {
  const base = normalize(strategy);
  if (!base) return null;
  const allowedBase = normalize(filterAllowedActions(base, options.allowedActions));
  if (!allowedBase) return null;

  const deviation = DEVIATION_PROFILES[profile?.name];
  if (!deviation) return allowedBase;

  const confidence = clamp01(options.confidence === undefined ? 0.5 : options.confidence);
  const shiftScale = Math.max(0, 1 - confidence * 0.65);
  const maxTotalShift = Math.max(0.02, Math.min(0.25, options.maxTotalShift ?? 0.12));
  const shifted = { ...allowedBase };
  if (shifted.fold !== undefined) {
    shifted.fold = capShiftedProbability(
      allowedBase.fold,
      shifted.fold +
        (deviation.foldShift - Math.min(0.05, psych.callDownShift || 0)) * shiftScale,
      maxTotalShift
    );
  }

  const bluffBoost = deviation.bluffShift + Math.max(-0.03, Math.min(0.03, (profile?.bluffFreq || 0.2) - 0.2));
  const aggressionBoost =
    deviation.aggressionShift +
    Math.max(-0.03, Math.min(0.03, (profile?.aggression || 0.5) - 0.5)) +
    Math.max(-0.05, Math.min(0.05, (psych.betSizeMult || 1) - 1));

  for (const action of Object.keys(shifted)) {
    if (!isAggressiveAction(action)) continue;
    shifted[action] = capShiftedProbability(
      allowedBase[action],
      shifted[action] + (bluffBoost + aggressionBoost * 0.5) * shiftScale,
      maxTotalShift
    );
  }

  return normalize(filterAllowedActions(shifted, options.allowedActions)) || allowedBase;
}

module.exports = {
  SOLVER_ENABLED_NPCS,
  isSolverEligibleProfile,
  applyPersonaDeviation,
  capShiftedProbability,
  filterAllowedActions,
};
