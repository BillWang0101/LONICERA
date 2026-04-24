const fs = require('fs');
const os = require('os');
const path = require('path');

describe('save-manager', () => {
  let tempDir;
  let previousSaveDir;

  beforeEach(() => {
    previousSaveDir = process.env.SAVE_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lonicera-save-'));
    process.env.SAVE_DIR = tempDir;
    jest.resetModules();
  });

  afterEach(() => {
    if (previousSaveDir === undefined) delete process.env.SAVE_DIR;
    else process.env.SAVE_DIR = previousSaveDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('saves, loads, lists, and deletes a room save', () => {
    const { saveGame, loadGame, deleteSave, listSaves } = require('../save-manager');
    const game = {
      gameMode: 'cash',
      smallBlind: 10,
      bigBlind: 20,
      startChips: 1000,
      roundCount: 7,
      dealerIndex: 2,
      players: [
        { name: 'Alice', chips: 1200, isNPC: false, avatar: 'A', wins: 2, handsPlayed: 7 },
        {
          name: 'Li Bai',
          chips: 800,
          isNPC: true,
          npcProfile: { name: 'Li Bai' },
          wins: 1,
          handsPlayed: 7,
        },
      ],
      leaderboard: { stats: { Alice: { handsWon: 2 } } },
    };

    expect(saveGame('room1', game)).toBe(true);
    expect(loadGame('room1')).toMatchObject({
      roomId: 'room1',
      roundCount: 7,
      settings: { smallBlind: 10, bigBlind: 20, startChips: 1000 },
    });
    expect(listSaves()).toEqual([
      expect.objectContaining({
        roomId: 'room1',
        playerCount: 2,
        humanCount: 1,
        npcCount: 1,
        blinds: '10/20',
      }),
    ]);

    expect(deleteSave('room1')).toBe(true);
    expect(loadGame('room1')).toBeNull();
  });

  test('ignores malformed save entries when listing saves', () => {
    const saveFile = path.join(tempDir, 'poker-saves.json');
    fs.writeFileSync(
      saveFile,
      JSON.stringify({
        good: {
          roomId: 'good',
          savedAt: 1,
          roundCount: 3,
          players: [{ name: 'Alice', isNPC: false }],
          settings: { smallBlind: 5, bigBlind: 10 },
        },
        bad: { roomId: 'bad', players: null },
      }),
      'utf8'
    );

    const { listSaves } = require('../save-manager');
    expect(listSaves()).toEqual([
      expect.objectContaining({ roomId: 'good', playerCount: 1, blinds: '5/10' }),
    ]);
  });
});
