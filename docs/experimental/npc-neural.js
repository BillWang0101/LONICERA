/**
 * npc-neural.js - Neural Network NPC Bridge (INACTIVE)
 *
 * This module bridges to an external NFSP/Deep CFR inference server.
 * Currently disabled — all NPCs use the rule-based engine.
 * Preserved for future integration when a stronger model is trained.
 *
 * : 149losein , 9action
 * action: fold, check_call, raise_33, raise_50, raise_67, raise_100, raise_200, raise_300, all_in
 */
const http = require('http');

const AI_SERVER_URL = process.env.AI_SERVER_URL || 'http://localhost:8900';
const TIMEOUT = 3000;
let aiOnline = false,
  lastCheck = 0;

const NEURAL_NPC_PROFILES = [
  {
    name: 'blue',
    avatar: '🤖',
    style: 'neural_balanced',
    agentId: 0,
    temperatureAdjust: 1.0,
    bluffBoost: 0.0,
    aggression: 0.0,
  },
  {
    name: '',
    avatar: '🎰',
    style: 'neural_aggressive',
    agentId: 1,
    temperatureAdjust: 1.2,
    bluffBoost: 0.15,
    aggression: 0.2,
  },
  {
    name: '',
    avatar: '🦊',
    style: 'neural_tricky',
    agentId: 2,
    temperatureAdjust: 0.8,
    bluffBoost: 0.25,
    aggression: 0.1,
  },
];

// ---- HTTP ----
function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: TIMEOUT,
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}

async function checkAIServer() {
  if (Date.now() - lastCheck < 10000) return aiOnline;
  lastCheck = Date.now();
  try {
    await httpPost(
      AI_SERVER_URL.replace('/decide', '/health').replace(':8900', ':8900/health'),
      {}
    );
    aiOnline = true;
  } catch {
    aiOnline = false;
  }
  return aiOnline;
}

// ---- card ----
function convertCard(c) {
  if (typeof c === 'string') {
    const sm = { '♥': 'h', '♦': 'd', '♣': 'c', '♠': 's', '♡': 'h', '♢': 'd', '♧': 'c', '♤': 's' };
    let s = c.trim();
    for (const [u, v] of Object.entries(sm)) s = s.replace(u, v);
    const rank = s.length === 3 ? s.slice(0, 2) : s[0];
    const suit = s[s.length - 1];
    return { rank: rank === '10' ? 'T' : rank, suit };
  }
  return { rank: c.rank === '10' ? 'T' : c.rank, suit: c.suit };
}

// ---- please (contains min-raise validate) ----
function buildRequest(profile, hole, board, gs, players) {
  const my = gs.seatIndex,
    dl = gs.dealerIndex || 0,
    np = gs.totalPlayers || players.length;
  const opps = players
    .filter((_, i) => i !== my)
    .map((p) => ({
      active: !p.folded && !p.allIn,
      all_in: !!p.allIn,
      folded: !!p.folded,
    }));
  const oc = players.filter((p, i) => i !== my && !p.folded).map((p) => p.chips || 0);

  const pot = gs.pot || 0,
    cb = gs.currentBet || 0,
    pb = gs.playerBet || 0;
  const chips = gs.chips || 0,
    mr = gs.minRaise || gs.bigBlind || 10;
  const ca = cb - pb;
  const canRaise = chips > ca;

  // 9action， and trainingwhen get_legal_actions
  const mask = [
    ca > 0, // 0: fold ( has betcan )
    true, // 1: check/call
    false,
    false,
    false,
    false,
    false,
    false, // 2-7: each raise
    false, // 8: all-in
  ];

  if (canRaise) {
    const multipliers = { 2: 0.33, 3: 0.5, 4: 0.67, 5: 1.0, 6: 2.0, 7: 3.0 };
    const ep = pot + ca;
    for (let i = 2; i <= 7; i++) {
      const rs = Math.max(Math.floor(ep * multipliers[i]), mr);
      const needed = cb + rs - pb;
      if (needed > ca && needed < chips) {
        mask[i] = true;
      }
    }
  }
  if (chips > 0) mask[8] = true;

  return {
    hole_cards: hole.map(convertCard),
    board: board.map(convertCard),
    pot,
    my_chips: chips,
    current_bet: cb,
    my_bet: pb,
    avg_opp_chips: oc.length ? oc.reduce((a, b) => a + b, 0) / oc.length : 500,
    active_players: gs.activePlayers || np,
    can_act_players: players.filter((p) => !p.folded && !p.allIn).length,
    num_players: np,
    starting_chips: gs.startingChips || 1000,
    big_blind: gs.bigBlind || 10,
    relative_position: (((my - dl) % np) + np) % np,
    phase: gs.phase || 'preflop',
    opponents: opps,
    legal_actions: mask,
    agent_id: profile.agentId || 0,
  };
}

// ---- action: AIactionindex → gameaction ----
function convertAction(ai, gs) {
  const pot = gs.pot || 0,
    cb = gs.currentBet || 0,
    pb = gs.playerBet || 0;
  const chips = gs.chips || 0,
    mr = gs.minRaise || gs.bigBlind || 10;
  const ca = cb - pb;

  if (ai === 0) return { action: 'fold' };
  if (ai === 1) return ca <= 0 ? { action: 'check' } : { action: 'call' };
  if (ai === 8) return { action: 'raise', amount: chips };

  const multipliers = { 2: 0.33, 3: 0.5, 4: 0.67, 5: 1.0, 6: 2.0, 7: 3.0 };
  const mult = multipliers[ai] || 1.0;
  const ep = pot + ca;
  const rs = Math.max(Math.floor(ep * mult), mr);
  const needed = cb + rs - pb;
  return needed >= chips ? { action: 'raise', amount: chips } : { action: 'raise', amount: needed };
}

// ---- ----
function applyPersonality(probs, profile) {
  const adj = [...probs];
  if (profile.bluffBoost > 0 && adj[0] > 0.3) {
    const sh = adj[0] * profile.bluffBoost;
    adj[0] -= sh;
    adj[5] += sh * 0.6;
    adj[6] += sh * 0.4;
  }
  if (profile.aggression > 0 && adj[1] > 0.3) {
    const sh = adj[1] * profile.aggression;
    adj[1] -= sh;
    adj[3] += sh * 0.3;
    adj[4] += sh * 0.3;
    adj[5] += sh * 0.2;
    adj[6] += sh * 0.2;
  }
  const sum = adj.reduce((a, b) => a + b, 0);
  if (sum > 0) for (let i = 0; i < adj.length; i++) adj[i] /= sum;
  return adj;
}

function weightedSample(p) {
  const r = Math.random();
  let c = 0;
  for (let i = 0; i < p.length; i++) {
    c += p[i];
    if (r < c) return i;
  }
  return p.length - 1;
}

// ---- in ----
async function neuralNpcDecision(profile, hole, board, gs, players, fallback) {
  if (!(await checkAIServer())) {
    const result = fallback ? fallback(profile, hole, board, gs) : { action: 'call' };
    result._neural = { status: 'offline' };
    return result;
  }
  try {
    const req = buildRequest(profile, hole, board, gs, players);
    const res = await httpPost(`${AI_SERVER_URL}/decide`, req);
    // Neural network NPCcard， not add ，receive use APIsamplingresult
    let a = res.action;
    if (!req.legal_actions[a]) {
      const valid = req.legal_actions.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
      a = valid.reduce((x, y) => (res.probabilities[x] > res.probabilities[y] ? x : y));
    }
    const result = convertAction(a, gs);
    result._neural = {
      status: 'ok',
      action_name: res.action_name,
      confidence: res.confidence,
      time_ms: res.inference_time_ms,
    };
    return result;
  } catch (e) {
    const result = fallback ? fallback(profile, hole, board, gs) : { action: 'call' };
    result._neural = { status: 'error', error: e.message };
    return result;
  }
}

module.exports = { neuralNpcDecision, NEURAL_NPC_PROFILES, checkAIServer };
