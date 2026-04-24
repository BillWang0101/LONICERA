const crypto = require('crypto');

function randomInt(max) {
  if (!Number.isInteger(max) || max <= 0) return 0;
  return crypto.randomInt(max);
}

function randomId(prefix = '') {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 9)}`;
}

module.exports = { randomInt, randomId };
