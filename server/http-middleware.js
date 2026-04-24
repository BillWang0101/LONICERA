function applySecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
}

function createRateLimiter({ limit, windowMs }) {
  const buckets = {};

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const ip of Object.keys(buckets)) {
      if (now > buckets[ip].reset) delete buckets[ip];
    }
  }, 300000);
  if (cleanupTimer.unref) cleanupTimer.unref();

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    if (!buckets[ip]) buckets[ip] = { count: 0, reset: now + windowMs };
    if (now > buckets[ip].reset) {
      buckets[ip] = { count: 0, reset: now + windowMs };
    }
    buckets[ip].count++;
    if (buckets[ip].count > limit) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}

module.exports = { applySecurityHeaders, createRateLimiter };
