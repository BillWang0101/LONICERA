// npc-psychology.js - NPC psychology engine
// NPCs with emotional swings, grudges, tilt, traps, bluffs
// Core idea: poker is human vs human, not human vs calculator

/**
 * NPC psychology state machine
 * Each NPC maintains independent psychological state affecting decisions
 */
class NPCPsychology {
  constructor() {
    this.states = new Map(); // npcId → psychState
  }

  getOrCreate(npcId, profile) {
    if (!this.states.has(npcId)) {
      this.states.set(npcId, {
        // ── Mood system ──
        mood: 'normal', // normal, tilted, confident, scared, vengeful, bored
        moodIntensity: 0, // 0~1, mood intensity
        moodDecay: 0, // decay per hand

        // ── Grudge system ──
        nemesis: null, // player who recently won big pot from me
        nemesisGrudge: 0, // 0~1, grudge level

        // ── Self-awareness ──
        recentResults: [], // last 5 results [{won, amount, hand}]
        winStreak: 0,
        loseStreak: 0,
        tableImage: 'unknown', // tight, loose, aggressive, passive, wild, unknown
        caughtBluffing: 0, // times caught bluffing
        successfulBluffs: 0, // successful bluff count

        // ── Gear shifting ──
        gearLevel: 0, // -2(very tight) ~ +2(very loose), 0=normal
        trapReady: false, // ready to set trap (been tight for a while)
        lastBigAction: null, // last big action {action, hand, result}

        // ── Game awareness ──
        handsAtTable: 0,
        totalChipsWon: 0,
        totalChipsLost: 0,
        bigPotThreshold: 0, // dynamic: what counts as "big pot"
      });
    }
    return this.states.get(npcId);
  }

  /**
   * Update psychology after each hand
   */
  updateAfterHand(npcId, result, profile) {
    const ps = this.getOrCreate(npcId, profile);
    ps.handsAtTable++;
    ps.bigPotThreshold = 200; // can be adjusted dynamically

    // Record result
    ps.recentResults.push(result);
    if (ps.recentResults.length > 8) ps.recentResults.shift();

    if (result.won) {
      ps.winStreak++;
      ps.loseStreak = 0;
      ps.totalChipsWon += result.amount;
    } else if (result.lost) {
      ps.loseStreak++;
      ps.winStreak = 0;
      ps.totalChipsLost += result.amount;
    }

    // ── Mood transitions ──

    // Consecutive losses trigger tilt
    if (ps.loseStreak >= 3 || (result.lost && result.amount > ps.bigPotThreshold)) {
      const tiltChance =
        profile.style === 'aggressive'
          ? 0.5
          : profile.style === 'maniac'
            ? 0.7
            : profile.style === 'tight'
              ? 0.15
              : profile.style === 'rock'
                ? 0.05
                : 0.3;
      if (Math.random() < tiltChance) {
        ps.mood = 'tilted';
        ps.moodIntensity = Math.min(1, 0.5 + ps.loseStreak * 0.15);
        ps.moodDecay = 3 + Math.floor(Math.random() * 3); // recover after 3-5 hands
      }
    }

    // Consecutive wins → confident/cocky
    if (ps.winStreak >= 3) {
      ps.mood = 'confident';
      ps.moodIntensity = Math.min(1, 0.4 + ps.winStreak * 0.1);
      ps.moodDecay = 4;
    }

    // Lost big pot → grudge
    if (result.lost && result.amount > ps.bigPotThreshold && result.taker) {
      ps.nemesis = result.taker;
      ps.nemesisGrudge = Math.min(1, 0.6 + result.amount / 1000);
      ps.mood = 'vengeful';
      ps.moodIntensity = 0.7;
      ps.moodDecay = 5;
    }

    // Caught bluffing → temporarily tighten
    if (result.caughtBluffing) {
      ps.caughtBluffing++;
      if (ps.caughtBluffing >= 2) {
        ps.mood = 'scared';
        ps.moodIntensity = 0.6;
        ps.moodDecay = 4;
        ps.gearLevel = Math.max(-2, ps.gearLevel - 1);
      }
    }

    // into bluff→below time can can again
    if (result.successfulBluff) {
      ps.successfulBluffs++;
    }

    // mooddecay
    if (ps.moodDecay > 0) {
      ps.moodDecay--;
    } else if (ps.mood !== 'normal') {
      ps.mood = 'normal';
      ps.moodIntensity = 0;
    }

    // ── strategy ──
    // too →standardset trap(switch to )
    if (ps.gearLevel <= -1 && ps.handsAtTable > 10 && Math.random() < 0.15) {
      ps.trapReady = true;
      ps.gearLevel = 1; // to
    }
    // too →tighten
    if (ps.gearLevel >= 1 && Math.random() < 0.1) {
      ps.gearLevel = Math.max(-1, ps.gearLevel - 1);
      ps.trapReady = false;
    }

    // new
    ps.tableImage = this.calculateTableImage(ps);
  }

  /**
   * calc(affectopponentif what see NPC)
   */
  calculateTableImage(ps) {
    if (ps.handsAtTable < 5) return 'unknown';
    const recent = ps.recentResults.slice(-5);
    const aggressiveActions = recent.filter((r) => r.wasAggressive).length;
    const bluffs = ps.caughtBluffing + ps.successfulBluffs;

    if (bluffs >= 3) return 'wild';
    if (aggressiveActions >= 4) return 'aggressive';
    if (aggressiveActions <= 1) return 'tight';
    return 'balanced';
  }

  /**
   * get psychstatedecisionadjust
   * return back groupmultiplynumber and shiftamount, NPCdecisionenginethis adjustbehavior
   */
  getDecisionModifiers(npcId, opponentId, profile) {
    const ps = this.getOrCreate(npcId, profile);
    const mods = {
      // adjust
      tightnessShift: 0, // =, =
      aggressionShift: 0, // =, =aggressive
      bluffFreqShift: 0, // bluff frequencyshift
      callDownShift: 0, // =call down (bluff)
      betSizeMult: 1.0, // below betbig small multiplynumber

      // behaviorsend
      shouldTrap: false, // is set trap(strongcheck-callnon-raise)
      shouldOverbet: false, // is below bet(intimidation)
      targetPlayer: null, // player
      shouldSpeech: null, // NPC()

      // info
      mood: ps.mood,
      moodIntensity: ps.moodIntensity,
    };

    // ── moodbehaviorshift ──

    switch (ps.mood) {
      case 'tilted':
        // tilted: , , below betbig , bluff
        mods.tightnessShift = -0.15 * ps.moodIntensity;
        mods.aggressionShift = 0.2 * ps.moodIntensity;
        mods.bluffFreqShift = 0.15 * ps.moodIntensity;
        mods.betSizeMult = 1.0 + 0.5 * ps.moodIntensity;
        if (Math.random() < 0.3) {
          mods.shouldOverbet = true;
        }
        break;

      case 'confident':
        // confident: , valuebelow bet and bluff
        mods.tightnessShift = -0.08 * ps.moodIntensity;
        mods.aggressionShift = 0.1 * ps.moodIntensity;
        mods.bluffFreqShift = 0.08 * ps.moodIntensity;
        break;

      case 'scared':
        // : tight, not bluff, only in strongout
        mods.tightnessShift = 0.15 * ps.moodIntensity;
        mods.aggressionShift = -0.1 * ps.moodIntensity;
        mods.bluffFreqShift = -0.15 * ps.moodIntensity;
        // but this is set trapgood when ——, bluff
        if (ps.trapReady && Math.random() < 0.25) {
          mods.shouldTrap = true;
          mods.bluffFreqShift = 0.3; // big bluff
        }
        break;

      case 'vengeful':
        // grudge: opponent, call/raisethey
        if (opponentId === ps.nemesis) {
          mods.callDownShift = 0.15 * ps.nemesisGrudge;
          mods.aggressionShift = 0.12 * ps.nemesisGrudge;
          mods.targetPlayer = ps.nemesis;
          mods.tightnessShift = -0.1;
        }
        break;
    }

    // ── ──
    mods.tightnessShift += ps.gearLevel * -0.08; // receiveaffect

    // ── trapmode ──
    if (ps.trapReady && ps.mood !== 'tilted') {
      mods.shouldTrap = true;
    }

    // ── behavior ──
    if (profile.style === 'tricky') {
      // : , opponent
      if (ps.handsAtTable % 7 === 0) {
        mods.tightnessShift += (Math.random() - 0.5) * 0.2;
        mods.aggressionShift += (Math.random() - 0.5) * 0.2;
      }
      // set trap
      if (Math.random() < 0.2) mods.shouldTrap = true;
    }

    if (profile.style === 'maniac') {
      // player: randombelow bet
      if (Math.random() < 0.15) {
        mods.shouldOverbet = true;
        mods.betSizeMult = 1.5 + Math.random();
      }
    }

    return mods;
  }

  /**
   * NPC (mood and hand)
   */
  generateChat(npcId, profile, situation) {
    const ps = this.getOrCreate(npcId, profile);
    if (Math.random() > 0.15) return null; // 85%when not

    const lines = {
      tilted: [
        'No. Not like this.',
        'These cards again...',
        'Unbelievable.',
        'I refuse this outcome.',
        'Enough.',
      ],
      confident: [
        'This spot is mine.',
        'I know what I am doing.',
        'Go on. Add more.',
        'You really want to test me?',
      ],
      scared: ['...', 'Let me think.', 'The numbers feel wrong.'],
      vengeful: [
        'That is not settled.',
        'I remember what happened.',
        'I will get those chips back.',
        'This hand is personal now.',
      ],
      normal_bluff: [
        'This bet speaks for itself.',
        'You can still fold.',
        'Go ahead. Test me.',
        'You do not win every hand.',
      ],
      normal_strong: ['I like where this is going.', 'Yes. This will do.'],
      normal_win: ['Good.', 'That worked nicely.', 'As expected.', 'We continue.'],
      normal_fold: [
        'Not this one.',
        'Too expensive for this hand.',
        'I can wait for a better spot.',
        'You may have this pot.',
      ],
    };

    let pool;
    if (ps.mood !== 'normal' && lines[ps.mood]) {
      pool = lines[ps.mood];
    } else if (situation === 'bluffing') {
      pool = lines.normal_bluff;
    } else if (situation === 'strong') {
      pool = lines.normal_strong;
    } else if (situation === 'won') {
      pool = lines.normal_win;
    } else if (situation === 'folded') {
      pool = lines.normal_fold;
    } else {
      return null;
    }

    return pool[Math.floor(Math.random() * pool.length)];
  }
}

module.exports = { NPCPsychology };
