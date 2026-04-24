const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function createStructuredLogger(scope, configuredLevel = process.env.LOG_LEVEL || 'info') {
  return ({ level = 'info', event, roomId, message, data = {} }) => {
    if ((LOG_LEVELS[level] ?? LOG_LEVELS.info) < (LOG_LEVELS[configuredLevel] ?? LOG_LEVELS.info))
      return;

    const entry = {
      ts: new Date().toISOString(),
      scope,
      level,
      event,
      roomId,
      message,
      ...data,
    };
    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
}

module.exports = { createStructuredLogger };
