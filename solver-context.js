const STREET_BET_BUCKETS = {
  flop: [33, 75, 130],
  turn: [50, 80, 150],
  river: [50, 100, 200],
};

const RAISE_BUCKETS = [250, 400];
const POSTFLOP_PHASES = ['flop', 'turn', 'river'];
const SOLVER_TAKEOVER_MODES = {
  STRICT_HU: 'strict_hu',
  SAFE_MULTIWAY_TO_HU: 'safe_multiway_to_hu',
};

function nearestBucket(value, buckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) return null;
  return buckets.reduce((best, bucket) =>
    Math.abs(bucket - value) < Math.abs(best - value) ? bucket : best
  );
}

function inferPreflopLine(actions) {
  const preflopActions = (actions || []).filter((action) => action.phase === 'preflop');
  const hasPreflopJam = preflopActions.some((action) => action.action === 'allin');
  if (hasPreflopJam) return null;

  const aggressiveCount = preflopActions.filter((action) => action.action === 'raise').length;
  if (aggressiveCount === 1) return 'SRP';
  if (aggressiveCount === 2) return '3BP';
  return null;
}

function encodeAggressiveToken(action, actor) {
  const streetPrefix = action.phase[0];
  if (action.action === 'allin') {
    return `${streetPrefix}_${actor}_j`;
  }

  if (action.toCallBeforeAction > 0) {
    const currentBetBefore = Math.max(1, action.currentBetBeforeAction || 0);
    const raiseToMultiple = ((action.playerBetAfterAction || 0) / currentBetBefore) * 100;
    const bucket = nearestBucket(raiseToMultiple, RAISE_BUCKETS);
    return `${streetPrefix}_${actor}_r${bucket}`;
  }

  const potBefore = Math.max(1, action.potBeforeAction || 0);
  const betPercent = Math.round(((action.contribution || 0) / potBefore) * 100);
  const bucket = nearestBucket(betPercent, STREET_BET_BUCKETS[action.phase] || []);
  return `${streetPrefix}_${actor}_b${bucket}`;
}

function buildActionLine({ actions, currentPhase, ipPlayerId, oopPlayerId }) {
  const stopAt = POSTFLOP_PHASES.indexOf(currentPhase);
  if (stopAt === -1) return 'root';

  const visiblePhases = new Set(POSTFLOP_PHASES.slice(0, stopAt + 1));
  const tokens = [];

  for (const action of actions || []) {
    if (!visiblePhases.has(action.phase)) continue;

    const actor =
      action.playerId === ipPlayerId ? 'ip' : action.playerId === oopPlayerId ? 'oop' : null;
    if (!actor) continue;

    const streetPrefix = action.phase[0];
    switch (action.action) {
      case 'check':
        tokens.push(`${streetPrefix}_${actor}_x`);
        break;
      case 'call':
        tokens.push(`${streetPrefix}_${actor}_c`);
        break;
      case 'fold':
        tokens.push(`${streetPrefix}_${actor}_f`);
        break;
      case 'raise':
      case 'allin':
        tokens.push(encodeAggressiveToken(action, actor));
        break;
      default:
        break;
    }
  }

  return tokens.length > 0 ? tokens.join('__') : 'root';
}

function unsupported(reason) {
  return { supported: false, reason };
}

function isSafeMultiwayToHuTakeover({ players, buttonPlayer, bigBlindPlayer, handStartPlayerCount, handActionLog }) {
  if (handStartPlayerCount <= 2 || !buttonPlayer || !bigBlindPlayer) return false;

  const allowedIds = new Set([buttonPlayer.id, bigBlindPlayer.id]);
  const livePlayers = (players || []).filter((player) => !player.folded);
  if (livePlayers.length !== 2 || livePlayers.some((player) => !allowedIds.has(player.id))) {
    return false;
  }

  const actions = handActionLog || [];
  if (actions.some((action) => POSTFLOP_PHASES.includes(action.phase) && !allowedIds.has(action.playerId))) {
    return false;
  }

  const preflopActions = actions.filter((action) => action.phase === 'preflop');
  const raises = preflopActions.filter((action) => action.action === 'raise');
  if (raises.length !== 1 || raises[0].playerId !== buttonPlayer.id) return false;
  if (preflopActions.some((action) => action.action === 'allin')) return false;
  if (preflopActions.some((action) => !allowedIds.has(action.playerId) && action.action !== 'fold')) {
    return false;
  }
  if (preflopActions.some((action) => action.playerId === bigBlindPlayer.id && action.action === 'raise')) {
    return false;
  }

  return preflopActions.some(
    (action) => action.playerId === bigBlindPlayer.id && action.action === 'call'
  );
}

function buildSolverContext({
  players,
  currentPlayerId,
  dealerIndex,
  bbIndex,
  handStartPlayerCount,
  handStartStacks,
  handActionLog,
  bigBlind,
  phase,
  communityCards,
}) {
  if (!POSTFLOP_PHASES.includes(phase)) return unsupported('not_postflop');
  if ((communityCards || []).length < 3) return unsupported('missing_flop');

  const livePlayers = (players || []).filter((player) => !player.folded);
  if (livePlayers.length !== 2) return unsupported('not_heads_up_now');

  const hero = livePlayers.find((player) => player.id === currentPlayerId);
  if (!hero) return unsupported('missing_current_player');

  const villain = livePlayers.find((player) => player.id !== currentPlayerId);
  if (!villain) return unsupported('missing_opponent');

  const buttonPlayer = players[dealerIndex];
  const bigBlindPlayer = players[bbIndex];
  if (!buttonPlayer || !bigBlindPlayer) return unsupported('missing_blind_roles');

  const takeoverMode =
    handStartPlayerCount === 2
      ? SOLVER_TAKEOVER_MODES.STRICT_HU
      : isSafeMultiwayToHuTakeover({
          players,
          buttonPlayer,
          bigBlindPlayer,
          handStartPlayerCount,
          handActionLog,
        })
        ? SOLVER_TAKEOVER_MODES.SAFE_MULTIWAY_TO_HU
        : null;
  if (!takeoverMode) return unsupported('hand_not_started_heads_up');

  const heroRole =
    hero.id === buttonPlayer.id ? 'IP' : hero.id === bigBlindPlayer.id ? 'OOP' : null;
  if (!heroRole) return unsupported('unsupported_position_pair');

  const preflopLine = inferPreflopLine(handActionLog);
  if (!preflopLine) return unsupported('unsupported_preflop_line');

  const effectiveStackStart = Math.min(
    handStartStacks?.[hero.id] ?? hero.chips,
    handStartStacks?.[villain.id] ?? villain.chips
  );

  return {
    supported: true,
    reason: null,
    phase,
    positionPair: 'BTN_vs_BB',
    takeoverMode,
    takeoverReason:
      takeoverMode === SOLVER_TAKEOVER_MODES.STRICT_HU
        ? 'hand_started_heads_up'
        : 'multiway_preflop_folded_to_btn_vs_bb_srp',
    heroId: hero.id,
    villainId: villain.id,
    heroRole,
    villainRole: heroRole === 'IP' ? 'OOP' : 'IP',
    buttonId: buttonPlayer.id,
    bigBlindId: bigBlindPlayer.id,
    preflopLine,
    effectiveStackStart,
    effectiveBB: bigBlind > 0 ? effectiveStackStart / bigBlind : 0,
    flop: communityCards.slice(0, 3),
    board: communityCards.slice(),
    actionLine: buildActionLine({
      actions: handActionLog,
      currentPhase: phase,
      ipPlayerId: buttonPlayer.id,
      oopPlayerId: bigBlindPlayer.id,
    }),
  };
}

module.exports = {
  buildActionLine,
  buildSolverContext,
  inferPreflopLine,
  isSafeMultiwayToHuTakeover,
  nearestBucket,
  SOLVER_TAKEOVER_MODES,
};
