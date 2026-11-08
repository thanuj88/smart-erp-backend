const tokenService = require('../services/tokenService');
const permissionService = require('../services/permissionService');
const { normalizeRole, userHasAnyPermission, PERMISSIONS } = require('../config/permissions');

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  let decoded;
  try {
    decoded = tokenService.verifyAccessToken(token);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (decoded.type && decoded.type !== 'access') {
    return res.status(401).json({ error: 'Invalid token type' });
  }

  const role = normalizeRole(decoded.role);
  let permissions;
  try {
    // The role's current permissions, not the copy inside the token. A permission removed from a
    // role (or a role that no longer exists) takes effect on the next request, not after 15 minutes.
    // permissionService caches per role for a minute, so this is not a database read per request.
    permissions = await permissionService.getPermissionsForRole(role);
  } catch (error) {
    console.error('Permission lookup failed:', error.message);
    return res.status(503).json({ error: 'Authorization is temporarily unavailable' });
  }

  req.user = {
    id: decoded.id || decoded.sub,
    username: decoded.username,
    email: decoded.email,
    role,
    tenantId: decoded.tenantId,
    branchId: decoded.branchId,
    permissions,
    trialEndsAt: decoded.trialEndsAt,
  };
  next();
};
// Tenant admin: store owners and platform operators.
// inventory:manage is stock work, not admin — clerks must not pass requireAdmin or see profit.
function isAdminUser(user) {
  return userHasAnyPermission(user?.permissions, [
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

function canViewReports(user) {
  return userHasAnyPermission(user?.permissions, [
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.PLATFORM_MANAGE,
  ]);
}

// Store-wide reports and sale history. `sales:create` alone (tellers) is deliberately not enough:
// those responses carry store totals and margin that tellers must not see.
const requireReportsAccess = (req, res, next) => {
  if (isAdminUser(req.user) || canViewReports(req.user)) {
    return next();
  }
  return res.status(403).json({ error: 'Access denied. Reports permission required.' });
};

const requireAdmin = (req, res, next) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
  }
  next();
};

/** Catalog writes. Inventory clerks pass here; they do not pass requireAdmin. */
const requireInventoryManage = (req, res, next) => {
  if (
    isAdminUser(req.user) ||
    userHasAnyPermission(req.user?.permissions, [PERMISSIONS.INVENTORY_MANAGE])
  ) {
    return next();
  }
  return res.status(403).json({ error: 'Access denied. Inventory permission required.' });
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
  requireInventoryManage,
  requireTeller,
  requireTenantAdmin,
  requireReportsAccess,
  isAdminUser,
  canSellUser,
  canViewReports,
};
