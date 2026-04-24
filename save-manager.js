// save-manager.js - Game save/load persistence
const fs = require('fs');
const path = require('path');

const SAVE_DIR = process.env.SAVE_DIR || path.join(__dirname, 'data');
const SAVE_FILE = path.join(SAVE_DIR, 'poker-saves.json');

function ensureDir() {
  try {
    if (!fs.existsSync(SAVE_DIR)) {
      fs.mkdirSync(SAVE_DIR, { recursive: true });
    }
  } catch (e) {
    console.warn('Cannot create save directory:', e.message);
  }
}

/**
 * Save a game room's state to disk
 */
function saveGame(roomId, game) {
  ensureDir();
  try {
    const allSaves = loadAllSaves();

    allSaves[roomId] = {
      roomId,
      savedAt: Date.now(),
      gameMode: game.gameMode || 'cash',
      settings: {
        smallBlind: game.smallBlind,
        bigBlind: game.bigBlind,
        startChips: game.startChips,
      },
      roundCount: game.roundCount,
      dealerIndex: game.dealerIndex,
      players: game.players.map((p) => ({
        name: p.name,
        chips: p.chips,
        isNPC: p.isNPC,
        npcProfileName: p.isNPC ? p.npcProfile.name : null,
        avatar: p.avatar || null,
        wins: p.wins || 0,
        handsPlayed: p.handsPlayed || 0,
      })),
      leaderboard: game.leaderboard ? game.leaderboard.stats : {},
    };

    const tmpFile = SAVE_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(allSaves, null, 2), 'utf8');
    fs.renameSync(tmpFile, SAVE_FILE); // Atomic on most filesystems
    return true;
  } catch (e) {
    console.error('Save failed:', e.message);
    return false;
  }
}

/**
 * Load all saves from disk
 */
function loadAllSaves() {
  try {
    if (fs.existsSync(SAVE_FILE)) {
      const raw = fs.readFileSync(SAVE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        console.error('Save file corrupted (not an object), resetting to empty');
        return {};
      }
      return parsed;
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      console.error('Save file corrupted (invalid JSON):', e.message);
    } else {
      console.warn('Load saves failed:', e.message);
    }
  }
  return {};
}

/**
 * Load a specific room's save
 */
function loadGame(roomId) {
  const saves = loadAllSaves();
  return saves[roomId] || null;
}

/**
 * Delete a save
 */
function deleteSave(roomId) {
  ensureDir();
  try {
    const saves = loadAllSaves();
    delete saves[roomId];
    const tmpFile = SAVE_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(saves, null, 2), 'utf8');
    fs.renameSync(tmpFile, SAVE_FILE);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * List all saved games
 */
function listSaves() {
  const saves = loadAllSaves();
  return Object.values(saves)
    .filter((s) => s && typeof s === 'object' && Array.isArray(s.players) && s.settings)
    .map((s) => ({
      roomId: s.roomId,
      savedAt: s.savedAt,
      gameMode: s.gameMode || 'cash',
      playerCount: s.players.length,
      humanCount: s.players.filter((p) => !p.isNPC).length,
      npcCount: s.players.filter((p) => p.isNPC).length,
      roundCount: s.roundCount,
      smallBlind: s.settings.smallBlind,
      bigBlind: s.settings.bigBlind,
      startChips: s.settings.startChips,
      blinds: s.settings.smallBlind + '/' + s.settings.bigBlind,
    }));
}

module.exports = { saveGame, loadGame, deleteSave, listSaves };
