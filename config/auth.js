require('dotenv').config();

module.exports = {
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
  skipCaptcha: process.env.SKIP_CAPTCHA === 'true' || process.env.NODE_ENV === 'development',
  exposeDevTokens: process.env.NODE_ENV !== 'production',
};
