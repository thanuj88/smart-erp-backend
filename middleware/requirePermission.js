const { userHasAnyPermission } = require('../config/permissions');

function requirePermission(...permissions) {
  return (req, res, next) => {
    const userPerms = req.user?.permissions || [];
    if (!userHasAnyPermission(userPerms, permissions)) {
      return res.status(403).json({
        error: 'Forbidden - insufficient permissions',
        required: permissions,
      });
    }
    next();
  };
}

module.exports = requirePermission;
