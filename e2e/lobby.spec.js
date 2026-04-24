const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');

let serverModule;
let baseUrl;
let tempDir;
const originalEnv = { ...process.env };

test.beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lonicera-pw-'));
  process.env.PREFLOP_TABLE = 'off';
  process.env.SAVE_DIR = tempDir;
  process.env.HOST = '127.0.0.1';
  delete require.cache[require.resolve('../server')];
  serverModule = require('../server');
  await serverModule.startServer({
    port: 0,
    host: '127.0.0.1',
    buildPreflop: false,
    unrefServer: true,
  });
  baseUrl = `http://127.0.0.1:${serverModule.server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => serverModule.io.close(resolve));
  if (serverModule.server.listening) {
    await new Promise((resolve) => serverModule.server.close(resolve));
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.env = originalEnv;
});

test('mode switch updates feedback copy and practice unlocks local settings', async ({ page }) => {
  await page.goto(baseUrl);

  await expect(page.locator('#modeFeedbackTitle')).toHaveText('Cash Game');
  await expect(page.locator('#modeFeedbackText')).toContainText('deep stacks');

  await page.click('#modeBtn_tournament');
  await expect(page.locator('#modeFeedbackTitle')).toHaveText('Tournament');
  await expect(page.locator('#modeFeedbackText')).toContainText('rising pressure');
  await expect(page.locator('#labelStartChips')).toHaveText('Starting Stack');
  await expect(page.locator('#btnTakeASeat')).toHaveText('Select Tournament Room');

  await page.click('#modeBtn_practice');
  await expect(page.locator('#modeFeedbackTitle')).toHaveText('Practice');
  await expect(page.locator('#practiceDirectStart')).toBeVisible();
  await expect(page.locator('#practiceDirectStart')).toContainText('quick reps');
  await expect(page.locator('#roomListSection')).toBeHidden();
  await expect(page.locator('#btnTakeASeat')).toHaveText('Start Practice');
  await expect(page.locator('#labelNpcCount')).toHaveText('AI Opponents');

  const zeroNpcOption = page.locator('#npcCount option[value="0"]');
  await expect(zeroNpcOption).toBeHidden();
});

test('preset rooms render and update the selection summary', async ({ page }) => {
  await page.goto(baseUrl);

  const roomCards = page.locator('.room-card');
  await expect(roomCards.first()).toBeVisible();
  await expect(roomCards).toHaveCount(8);

  await roomCards.first().click();
  await expect(page.locator('#roomSelectionName')).not.toHaveText('Select a room below');
  await expect(page.locator('#roomSelectionMeta')).toContainText(/Cash Game|Tournament|Empty preset room/i);
});

test('practice join enters the table and does not require a room selection', async ({ page }) => {
  await page.goto(baseUrl);

  await page.fill('#playerName', 'Practice Tester');
  await page.click('#modeBtn_practice');
  await page.click('#btnTakeASeat');

  await expect(page.locator('#gameScreen')).toHaveClass(/active/);
  await expect(page.locator('#modeBadge')).toHaveText('Practice');
  await expect(page.locator('#topInfo')).toContainText(/Practice|Waiting|ready/i);
});

test('equity widget reuses the current street result and only advances on new board states', async ({
  page,
}) => {
  await page.goto(baseUrl);
  await page.fill('#playerName', 'Equity Tester');
  const roomCard = page.locator('.room-card[data-room="岳阳楼"]').first();
  const roomId = await roomCard.getAttribute('data-room');
  await roomCard.click();
  await page.click('#btnTakeASeat');
  await expect(page.locator('#gameScreen')).toHaveClass(/active/);

  const game = serverModule.games.get(roomId);
  const hero = game.players.find((player) => !player.isNPC);
  const villain = game.players.find((player) => player.isNPC);

  game.isRunning = true;
  game.phase = 'flop';
  game.communityCards = [
    { suit: 'hearts', value: 10, rank: '10' },
    { suit: 'spades', value: 9, rank: '9' },
    { suit: 'diamonds', value: 8, rank: '8' },
  ];
  hero.folded = false;
  hero.holeCards = [
    { suit: 'spades', value: 14, rank: 'A' },
    { suit: 'clubs', value: 14, rank: 'A' },
  ];
  hero.chips = 200;
  villain.folded = false;
  villain.holeCards = [
    { suit: 'diamonds', value: 13, rank: 'K' },
    { suit: 'hearts', value: 13, rank: 'K' },
  ];
  game.equityState[hero.id] = { freeLeft: 1, priceLevel: 0, unusedStreak: 0 };
  game.emitUpdate(game);

  const badge = page.locator('#eqSideBadge');
  const eqButton = page.locator('#eqSideBtn');

  await expect(page.locator('#eqSide')).toBeVisible();
  await expect(badge).toHaveText('free×1');

  await eqButton.click();
  await expect(page.locator('#eqRulesModal')).toBeVisible();
  await page.click('#btnCloseEqRules');
  await expect(badge).toHaveText('20');

  await eqButton.click();
  await expect(badge).toHaveText('20');
  await expect(page.locator('#eqConfirmModal')).toBeHidden();

  game.phase = 'turn';
  game.communityCards.push({ suit: 'clubs', value: 7, rank: '7' });
  game.emitUpdate(game);

  await eqButton.click();
  await expect(page.locator('#eqConfirmModal')).toBeVisible();
  await expect(page.locator('#eqConfirmPrice')).toHaveText('20');
  await page.click('#btnConfirmEqPurchase');
  await expect(badge).toHaveText('40');

  game.phase = 'river';
  game.communityCards.push({ suit: 'hearts', value: 2, rank: '2' });
  game.emitUpdate(game);

  await eqButton.click();
  await expect(page.locator('#eqConfirmModal')).toBeVisible();
  await expect(page.locator('#eqConfirmPrice')).toHaveText('40');
  await page.click('#btnConfirmEqPurchase');
  await expect(badge).toHaveText('80');

  expect(roomId).toBeTruthy();
});

test('equity widget does not advance when only action state changes', async ({ page }) => {
  await page.goto(baseUrl);
  await page.fill('#playerName', 'Equity Freeze');
  const roomCard = page.locator('.room-card[data-room="洛阳"]').first();
  const roomId = await roomCard.getAttribute('data-room');
  await roomCard.click();
  await page.click('#btnTakeASeat');
  await expect(page.locator('#gameScreen')).toHaveClass(/active/);

  const game = serverModule.games.get(roomId);
  const hero = game.players.find((player) => !player.isNPC);
  const villain = game.players.find((player) => player.isNPC);

  game.isRunning = true;
  game.phase = 'turn';
  game.communityCards = [
    { suit: 'hearts', value: 10, rank: '10' },
    { suit: 'spades', value: 9, rank: '9' },
    { suit: 'diamonds', value: 8, rank: '8' },
    { suit: 'clubs', value: 7, rank: '7' },
  ];
  hero.folded = false;
  hero.holeCards = [
    { suit: 'spades', value: 14, rank: 'A' },
    { suit: 'clubs', value: 14, rank: 'A' },
  ];
  hero.chips = 200;
  villain.folded = false;
  villain.holeCards = [
    { suit: 'diamonds', value: 13, rank: 'K' },
    { suit: 'hearts', value: 13, rank: 'K' },
  ];
  game.equityState[hero.id] = { freeLeft: 0, priceLevel: 0, unusedStreak: 0 };
  game.emitUpdate(game);

  const badge = page.locator('#eqSideBadge');
  const eqButton = page.locator('#eqSideBtn');

  await expect(badge).toHaveText('20');
  await eqButton.click();
  await expect(page.locator('#eqRulesModal')).toBeVisible();
  await page.click('#btnCloseEqRules');
  await expect(page.locator('#eqConfirmModal')).toBeVisible();
  await expect(page.locator('#eqConfirmPrice')).toHaveText('20');
  await page.click('#btnConfirmEqPurchase');
  await expect(badge).toHaveText('40');

  game.currentBet = 80;
  villain.bet = 80;
  villain.totalBet = 120;
  game.handActionHistory[villain.id] = [{ action: 'raise', amount: 80 }];
  game.emitUpdate(game);

  await eqButton.click();
  await expect(badge).toHaveText('40');
  await expect(page.locator('#eqConfirmModal')).toBeHidden();
});
