const nodemailer = require('nodemailer');

let transport = null;

function isConfigured(env = process.env) {
  return Boolean(env.SMTP_HOST && String(env.SMTP_HOST).trim());
}

function getTransport(env = process.env) {
  if (transport) return transport;
  const port = Number(env.SMTP_PORT) || 587;
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
  });
  return transport;
}

/** Tests inject a fake transport; pass null to reset. */
function _setTransport(next) {
  transport = next;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fromAddress(env = process.env) {
  return env.MAIL_FROM || env.SMTP_USER || 'no-reply@localhost';
}

async function sendMail({ to, subject, text, html }, env = process.env) {
  if (!to) throw new Error('Recipient is required');
  if (!transport && !isConfigured(env)) {
    const err = new Error('Email delivery is not configured');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }
  await getTransport(env).sendMail({ from: fromAddress(env), to, subject, text, html });
}

function linkMessage({ greeting, intro, url, cta, outro }) {
  const text = `${greeting}\n\n${intro}\n\n${url}\n\n${outro}`;
  const html =
    `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p>` +
    `<p><a href="${escapeHtml(url)}">${escapeHtml(cta)}</a></p>` +
    `<p>${escapeHtml(outro)}</p>`;
  return { text, html };
}

function sendVerificationEmail({ to, name, url }, env) {
  const msg = linkMessage({
    greeting: `Hi ${name || 'there'},`,
    intro: 'Confirm your email address to activate your POSBright account.',
    url,
    cta: 'Verify my email',
    outro: 'If you did not create this account you can ignore this message.',
  });
  return sendMail({ to, subject: 'Verify your email address', ...msg }, env);
}

function sendPasswordResetEmail({ to, name, url }, env) {
  const msg = linkMessage({
    greeting: `Hi ${name || 'there'},`,
    intro: 'We received a request to reset your password. The link works once and expires soon.',
    url,
    cta: 'Choose a new password',
    outro: 'If you did not ask for this you can ignore this message. Your password stays the same.',
  });
  return sendMail({ to, subject: 'Reset your password', ...msg }, env);
}

module.exports = {
  isConfigured,
  sendMail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  _setTransport,
};
