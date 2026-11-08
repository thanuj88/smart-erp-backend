require('dotenv').config();

/**
 * Dev shortcuts must be opt-in and local.
 *  - Captcha is skipped only when NODE_ENV is development or test. An unset or unknown
 *    NODE_ENV counts as deployed, so SKIP_CAPTCHA=true in a real environment does nothing.
 *  - Verify and reset tokens are only put in API responses with EXPOSE_DEV_TOKENS=true,
 *    and never when NODE_ENV=production.
 */
function resolveSecurityFlags(env = process.env) {
  const nodeEnv = env.NODE_ENV;
  const isLocalDev = nodeEnv === 'development' || nodeEnv === 'test';
  return {
    isLocalDev,
    skipCaptcha: isLocalDev && (env.SKIP_CAPTCHA === 'true' || nodeEnv === 'development'),
    exposeDevTokens: env.EXPOSE_DEV_TOKENS === 'true' && nodeEnv !== 'production',
  };
}

const securityFlags = resolveSecurityFlags();

module.exports = {
  resolveSecurityFlags,
  accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
  refreshTokenExpiryDays: parseInt(process.env.JWT_REFRESH_DAYS || '7', 10),
  refreshTokenExpiryMs: parseInt(process.env.JWT_REFRESH_DAYS || '7', 10) * 24 * 60 * 60 * 1000,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || `${process.env.JWT_SECRET || 'default_secret_change_in_production'}_refresh`,
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
  trialDays: parseInt(process.env.TRIAL_DAYS || '30', 10),
  maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
  lockoutMinutes: parseInt(process.env.LOCKOUT_MINUTES || '15', 10),
  verificationTokenHours: 24,
  resetTokenHours: 1,
  skipCaptcha: securityFlags.skipCaptcha,
  exposeDevTokens: securityFlags.exposeDevTokens,
};
