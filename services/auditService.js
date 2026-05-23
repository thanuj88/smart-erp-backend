const { getAuthRepository } = require('../repositories/factory');

async function logAuthEvent(payload) {
  try {
    await getAuthRepository().logAuthEvent(payload);
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

module.exports = { logAuthEvent };
