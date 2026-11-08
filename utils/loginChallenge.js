const authConfig = require('../config/auth');
const { verifyCaptcha } = require('./captcha');

/** Failed attempts on one account before sign-in asks for a CAPTCHA. Lockout still applies after MAX_LOGIN_ATTEMPTS. */
function failuresBeforeCaptcha(env = process.env) {
  const n = parseInt(env.CAPTCHA_AFTER_FAILURES || '3', 10);
  return Number.isFinite(n) && n >= 1 ? n : 3;
}

/**
 * Sign-in only challenges when CAPTCHA is actually set up (RECAPTCHA_SECRET present and not skipped).
 * Otherwise nobody could ever pass it and the account would just lock sooner.
 */
function isLoginCaptchaEnabled(env = process.env) {
  return !authConfig.skipCaptcha && Boolean(String(env.RECAPTCHA_SECRET || '').trim());
}

function needsCaptcha(failedAttempts, env = process.env) {
  return isLoginCaptchaEnabled(env) && (Number(failedAttempts) || 0) >= failuresBeforeCaptcha(env);
}

/**
 * Returns null when sign-in may continue, or the 400 body to send when a CAPTCHA is needed.
 * Called before the password or PIN is checked, so a bot cannot keep guessing past the threshold.
 */
async function loginChallengeFailure(user, captchaToken, env = process.env) {
  if (!needsCaptcha(user?.failed_login_attempts, env)) return null;
  if (!captchaToken) {
    return { error: 'Please complete the CAPTCHA to continue.', captchaRequired: true };
  }
  if (!(await verifyCaptcha(captchaToken))) {
    return { error: 'CAPTCHA verification failed. Please try again.', captchaRequired: true };
  }
  return null;
}

module.exports = { failuresBeforeCaptcha, isLoginCaptchaEnabled, needsCaptcha, loginChallengeFailure };
