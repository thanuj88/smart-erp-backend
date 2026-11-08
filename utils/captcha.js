const authConfig = require('../config/auth');

async function verifyCaptcha(token) {
  if (authConfig.skipCaptcha) return true;
  if (!token) return false;

  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) {
    // Fail closed. Only a local dev environment may skip captcha, and that returned above.
    console.error('RECAPTCHA_SECRET is not set; rejecting captcha checks');
    return false;
  }

  try {
    const params = new URLSearchParams({
      secret,
      response: token,
    });
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error('Captcha verification failed:', err.message);
    return false;
  }
}

module.exports = { verifyCaptcha };
