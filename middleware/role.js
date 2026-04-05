// Middleware to check user role
const roleMiddleware = (requiredRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.user.role !== requiredRole && req.user.role !== 'admin') {
      return res.status(403).json({ 
        error: `Access denied. ${requiredRole} role required.` 
      });
    }

    next();
  };
};

module.exports = roleMiddleware;
