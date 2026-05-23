const tokenService = require('../services/tokenService');
const { normalizeRole, userHasAnyPermission, PERMISSIONS } = require('../config/permissions');

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = tokenService.verifyAccessToken(token);
    if (decoded.type && decoded.type !== 'access') {
      return res.status(401).json({ error: 'Invalid token type' });
    }
    req.user = {
      id: decoded.id || decoded.sub,
      username: decoded.username,
      email: decoded.email,
      role: normalizeRole(decoded.role),
      tenantId: decoded.tenantId,
      branchId: decoded.branchId,
      permissions: decoded.permissions || [],
      trialEndsAt: decoded.trialEndsAt,
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

function isAdminUser(user) {
  return userHasAnyPermission(user?.permissions, [
    PERMISSIONS.INVENTORY_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.PLATFORM_MANAGE,
  ]);
}

function canSellUser(user) {
  return userHasAnyPermission(user?.permissions, [
    PERMISSIONS.SALES_CREATE,
    PERMISSIONS.PLATFORM_MANAGE,
  ]);
}

const requireAdmin = (req, res, next) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
  }
  next();
};

const requireTeller = (req, res, next) => {
  if (!canSellUser(req.user)) {
    return res.status(403).json({ error: 'Access denied. Sales permission required.' });
  }
  next();
};

const requireTenantAdmin = (req, res, next) => {
  if (!userHasAnyPermission(req.user?.permissions, [PERMISSIONS.USERS_MANAGE, PERMISSIONS.PLATFORM_MANAGE])) {
    return res.status(403).json({ error: 'Access denied. User management permission required.' });
  }
  next();
};

module.exports = {
  authenticate,
  requireAdmin,
  requireTeller,
  requireTenantAdmin,
  isAdminUser,
  canSellUser,
};
