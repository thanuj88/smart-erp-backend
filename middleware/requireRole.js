/**
 * Middleware to check if user has the required role
 * @param {...string} allowedRoles - The roles allowed to access the route
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      const userRole = req.user?.role;

      if (!userRole) {
        return res.status(401).json({ error: 'Unauthorized - No role found' });
      }

      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({ 
          error: 'Forbidden - Insufficient role',
          required: allowedRoles,
          current: userRole
        });
      }

      next();
    } catch (error) {
      console.error('Error in requireRole middleware:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
};

module.exports = requireRole;
