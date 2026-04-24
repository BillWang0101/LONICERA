// preflop-worker.js - Runs in a Worker thread, does not block the main event loop
const { parentPort, workerData, isMainThread } = require('worker_threads');

// Guard: this file should only run as a Worker thread
if (isMainThread || !parentPort) return;

const { createDeck } = require('./deck');
const { evaluateHand, compareHands } = require('./hand-eval');
const { generate169HandTypes, getConcreteHand } = require('./preflop-table');

const SIMS = (workerData && workerData.sims) || 3000;
const handTypes = generate169HandTypes();
const maxOpp = 7;
const table = {};

function shuffleFast(arr) {
  const d = [...arr];
  for (let i = d.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = d[i];
    d[i] = d[j];
    d[j] = tmp;
  }
  return d;
}

for (let idx = 0; idx < handTypes.length; idx++) {
  const handType = handTypes[idx];
  table[handType] = {};
  const holeCards = getConcreteHand(handType);
  const knownSet = new Set(holeCards.map((c) => c.rank + c.suit));
  const remaining = createDeck().filter((c) => !knownSet.has(c.rank + c.suit));

  for (let numOpp = 1; numOpp <= maxOpp; numOpp++) {
    let wins = 0,
      ties = 0;
    for (let sim = 0; sim < SIMS; sim++) {
      const deck = shuffleFast(remaining);
      let di = 0;
      const board = [deck[di++], deck[di++], deck[di++], deck[di++], deck[di++]];
      const myHand = evaluateHand([...holeCards, ...board]);
      let isBest = true,
        isTied = false;
      for (let o = 0; o < numOpp; o++) {
        const oppHand = evaluateHand([deck[di++], deck[di++], ...board]);
        const cmp = compareHands(myHand, oppHand);
        if (cmp < 0) {
          isBest = false;
          break;
        }
        if (cmp === 0) isTied = true;
      }
      if (isBest && !isTied) wins++;
      else if (isBest && isTied) ties++;
    }
    table[handType][numOpp] = Math.round(((wins + ties * 0.5) / SIMS) * 10000) / 10000;
  }

  // Report progress every 10 hand types
  if ((idx + 1) % 10 === 0 || idx === handTypes.length - 1) {
    parentPort.postMessage({ type: 'progress', done: idx + 1, total: handTypes.length });
  }
}

// Send completed table back to main thread
parentPort.postMessage({ type: 'done', table });
