const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' },
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again later.' },
});

// Per signed-in user, not per IP: a till sits behind one shop IP, a scraper has one login.
function userKey(req) {
  return `${req.user?.tenantId ?? 'none'}:${req.user?.id ?? 'anon'}`;
}

/**
 * POS member lookup. The 300 ms debounce means a teller fires a lookup per pause while typing,
 * so the per-minute cap is generous. The hourly cap is what stops someone walking phone numbers.
 */
function createLookupLimiters({ perMinute = 30, perHour = 300 } = {}) {
  const base = {
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKey,
    validate: { keyGeneratorIpFallback: false },
    message: { error: 'Too many customer lookups. Please slow down and try again shortly.' },
  };
  return [
    rateLimit({ ...base, windowMs: 60 * 1000, limit: perMinute }),
    rateLimit({ ...base, windowMs: 60 * 60 * 1000, limit: perHour }),
  ];
}

const customerLookupLimiters = createLookupLimiters();

// A browser refreshes about once per 15 minutes. 60 per IP leaves room for a whole shop behind one
// address while stopping a loop that guesses or replays refresh tokens.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts. Please sign in again later.' },
});

module.exports = {
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
  refreshLimiter,
  createLookupLimiters,
  customerLookupLimiters,
};
