const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { jwtSecret } = require('../config/config');
const authConfig = require('../config/auth');
const { normalizeRole } = require('../config/permissions');
const { generateSecureToken, hashToken } = require('../utils/tokens');
const { getAuthRepository } = require('../repositories/factory');

function buildAccessPayload(user, trialEndsAt, permissions = []) {
  const role = normalizeRole(user.role);
  return {
    sub: user.id,
    id: user.id,
    username: user.username,
    email: user.email,
    role,
    tenantId: user.tenant_id,
    branchId: user.branch_id,
    permissions,
    trialEndsAt: trialEndsAt || null,
    type: 'access',
  };
}

function signAccessToken(user, trialEndsAt, permissions = []) {
  return jwt.sign(buildAccessPayload(user, trialEndsAt, permissions), jwtSecret, {
    expiresIn: authConfig.accessTokenExpiry,
  });
}

function signRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, type: 'refresh' },
    authConfig.jwtRefreshSecret,
    { expiresIn: `${authConfig.refreshTokenExpiryDays}d` }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, jwtSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, authConfig.jwtRefreshSecret);
}

async function storeRefreshToken(userId, refreshToken, meta = {}) {
  return getAuthRepository().storeRefreshToken(userId, refreshToken, meta);
}

async function findRefreshToken(refreshToken) {
  return getAuthRepository().findRefreshToken(refreshToken);
}

async function revokeRefreshToken(refreshToken) {
  return getAuthRepository().revokeRefreshToken(refreshToken);
}

async function revokeRefreshTokenById(id, userId) {
  return getAuthRepository().revokeRefreshTokenById(id, userId);
}

async function listUserSessions(userId) {
  return getAuthRepository().listUserSessions(userId);
}

async function hashPin(pin) {
  return bcrypt.hash(String(pin), authConfig.bcryptRounds);
}

async function comparePin(pin, pinHash) {
  if (!pinHash) return false;
  return bcrypt.compare(String(pin), pinHash);
}

module.exports = {
  buildAccessPayload,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  storeRefreshToken,
  findRefreshToken,
  revokeRefreshToken,
  revokeRefreshTokenById,
  listUserSessions,
  hashPin,
  comparePin,
  generateSecureToken,
  hashToken,
};
