// player-stats.js - Opponent Behavior Memory System
// Tracks player tendencies across multiple hands to build player profiles
// NPC uses these stats to adjust strategy against each opponent

class PlayerStats {
  constructor() {
    // Per-player stat storage: playerId → stats object
    this.stats = new Map();
  }

  /**
   * Initialize or get stats for a player
   */
  getOrCreate(playerId) {
    if (!this.stats.has(playerId)) {
      this.stats.set(playerId, {
        // Core frequencies (tracked as numerator/denominator for accuracy)
        handsPlayed: 0,
        handsWon: 0,

        // Preflop tendencies
        vpipCount: 0, // Voluntarily Put $ In Pot (called or raised preflop)
        vpipOpportunity: 0, // Hands where player could VPIP
        pfrCount: 0, // Preflop Raise count
        pfrOpportunity: 0, // Hands where player could raise preflop
        threeBetCount: 0, // 3-bet (re-raise preflop)
        threeBetOpportunity: 0,

        // Postflop tendencies
        cbetCount: 0, // Continuation bet (bet flop after preflop raise)
        cbetOpportunity: 0,
        betCount: 0, // Total bets/raises postflop
        callCount: 0, // Total calls postflop
        checkCount: 0, // Total checks postflop
        foldCount: 0, // Total folds postflop
        foldToRaiseCount: 0, // Folded when facing a raise
        foldToRaiseOpportunity: 0,

        // Showdown data (for calibrating ranges)
        showdownHands: [], // Last N hands shown at showdown [{holeCards, action, strength}]

        // Per-hand tracking (reset each hand)
        currentHand: {
          preflopAction: null, // 'fold', 'call', 'raise'
          wasPreRaiser: false,
          actions: [], // [{phase, action, amount}]
          position: null,
        },
      });
    }
    return this.stats.get(playerId);
  }

  /**
   * Start tracking a new hand for all players
   */
  newHand(playerIds) {
    for (const id of playerIds) {
      const s = this.getOrCreate(id);
      s.handsPlayed++;
      s.currentHand = {
        preflopAction: null,
        wasPreRaiser: false,
        actions: [],
        position: null,
      };
    }
  }

  /**
   * Record a player's action
   */
  recordAction(playerId, phase, action, amount, context) {
    const s = this.getOrCreate(playerId);
    s.currentHand.actions.push({ phase, action, amount });

    if (phase === 'preflop') {
      // VPIP: any voluntary call or raise (not posting blinds)
      if (!context.isBlind) {
        s.vpipOpportunity++;
        if (action === 'call' || action === 'raise' || action === 'allin') {
          s.vpipCount++;
        }
      }

      // PFR: preflop raise
      s.pfrOpportunity++;
      if (action === 'raise' || action === 'allin') {
        s.pfrCount++;
        s.currentHand.wasPreRaiser = true;
        s.currentHand.preflopAction = 'raise';

        // 3-bet: re-raising a raiser
        if (context.facingRaise) {
          s.threeBetOpportunity++;
          s.threeBetCount++;
        }
      } else if (action === 'call') {
        s.currentHand.preflopAction = 'call';
        if (context.facingRaise) {
          s.threeBetOpportunity++;
          // Didn't 3-bet
        }
      } else if (action === 'fold') {
        s.currentHand.preflopAction = 'fold';
      }
    } else {
      // Postflop actions
      switch (action) {
        case 'raise':
        case 'allin':
          s.betCount++;
          break;
        case 'call':
          s.callCount++;
          break;
        case 'check':
          s.checkCount++;
          break;
        case 'fold':
          s.foldCount++;
          break;
      }

      // Fold to raise tracking
      if (context.facingRaise) {
        s.foldToRaiseOpportunity++;
        if (action === 'fold') {
          s.foldToRaiseCount++;
        }
      }

      // C-bet tracking (flop bet by preflop raiser)
      if (phase === 'flop' && s.currentHand.wasPreRaiser) {
        if (context.firstToAct || context.checkedTo) {
          s.cbetOpportunity++;
          if (action === 'raise' || action === 'bet') {
            s.cbetCount++;
          }
        }
      }
    }
  }

  /**
   * Record showdown result
   */
  recordShowdown(playerId, holeCards, won) {
    const s = this.getOrCreate(playerId);
    if (won) s.handsWon++;

    // Keep last 30 showdown hands for range calibration
    s.showdownHands.push({
      holeCards: holeCards,
      preflopAction: s.currentHand.preflopAction,
      won: won,
      timestamp: Date.now(),
    });
    if (s.showdownHands.length > 30) {
      s.showdownHands.shift();
    }
  }

  /**
   * Get computed player profile (the stats NPC uses for decisions)
   */
  getProfile(playerId) {
    const s = this.getOrCreate(playerId);
    const totalPostflop = s.betCount + s.callCount + s.checkCount + s.foldCount;

    return {
      handsPlayed: s.handsPlayed,

      // VPIP: how loose/tight preflop (0-1, avg ~25%, fish >40%, nit <15%)
      vpip: s.vpipOpportunity > 0 ? s.vpipCount / s.vpipOpportunity : 0.3,

      // PFR: how aggressive preflop (0-1, avg ~18%, LAG >25%, passive <10%)
      pfr: s.pfrOpportunity > 0 ? s.pfrCount / s.pfrOpportunity : 0.2,

      // 3-bet frequency (0-1, avg ~5-7%)
      threeBet: s.threeBetOpportunity > 0 ? s.threeBetCount / s.threeBetOpportunity : 0.06,

      // Aggression factor: (bet+raise) / call. >2 = aggressive, <1 = passive
      aggression: s.callCount > 0 ? s.betCount / s.callCount : s.betCount > 0 ? 3 : 1,

      // C-bet frequency (0-1, avg ~60-70%)
      cbet: s.cbetOpportunity > 0 ? s.cbetCount / s.cbetOpportunity : 0.65,

      // Fold to raise (0-1, avg ~40-50%, exploitable >60%)
      foldToRaise:
        s.foldToRaiseOpportunity > 0 ? s.foldToRaiseCount / s.foldToRaiseOpportunity : 0.45,

      // Win rate
      winRate: s.handsPlayed > 0 ? s.handsWon / s.handsPlayed : 0,

      // How reliable is this data? (more hands = more reliable)
      sampleSize: s.handsPlayed,
      confidence: Math.min(1, s.handsPlayed / 30), // Full confidence after 30 hands

      // Derived player type classification
      playerType: classifyPlayer(s),

      // Raw showdown data for range calibration
      showdownHands: s.showdownHands,
    };
  }

  /**
   * Get all player profiles
   */
  getAllProfiles() {
    const profiles = {};
    for (const [id, _] of this.stats) {
      profiles[id] = this.getProfile(id);
    }
    return profiles;
  }
}

/**
 * Classify a player into a poker archetype based on their stats
 */
function classifyPlayer(s) {
  if (s.handsPlayed < 8) return 'unknown';

  const vpip = s.vpipOpportunity > 0 ? s.vpipCount / s.vpipOpportunity : 0.3;
  const pfr = s.pfrOpportunity > 0 ? s.pfrCount / s.pfrOpportunity : 0.2;
  const agg = s.callCount > 0 ? s.betCount / s.callCount : 1;

  // Tight-Aggressive (TAG): VPIP 15-25%, PFR 12-22%, High aggression
  if (vpip < 0.28 && pfr > 0.12 && agg > 1.5) return 'TAG';

  // Loose-Aggressive (LAG): VPIP >28%, PFR >20%, High aggression
  if (vpip > 0.28 && pfr > 0.2 && agg > 1.5) return 'LAG';

  // Tight-Passive (Rock/Nit): VPIP <20%, Low aggression
  if (vpip < 0.2 && agg < 1.5) return 'nit';

  // Loose-Passive (Calling Station): VPIP >35%, Low aggression
  if (vpip > 0.35 && agg < 1.2) return 'calling_station';

  // Maniac: VPIP >45%, PFR >30%
  if (vpip > 0.45 && pfr > 0.3) return 'maniac';

  return 'average';
}

module.exports = { PlayerStats };
