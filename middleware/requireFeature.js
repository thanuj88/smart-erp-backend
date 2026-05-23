const pool = require('../config/database');

/**
 * Middleware to check if user's tenant plan includes the required feature
 * @param {string} featureCode - The feature code to check (e.g., 'INSTALLMENT_PLANS')
 */
const requireFeature = (featureCode) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Get user with tenant and plan information
      const userResult = await pool.query(
        `SELECT u.id, u.tenant_id, t.plan_id 
         FROM users u 
         JOIN tenants t ON u.tenant_id = t.id 
         WHERE u.id = $1`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({ error: 'User not found' });
      }

      const { plan_id } = userResult.rows[0];

      // Check if the plan has this feature
      const featureResult = await pool.query(
        `SELECT pf.plan_id 
         FROM plan_features pf
         JOIN features f ON pf.feature_id = f.id
         WHERE pf.plan_id = $1 AND f.code = $2`,
        [plan_id, featureCode]
      );

      if (featureResult.rows.length === 0) {
        return res.status(403).json({ 
          error: 'Feature not available in your plan',
          feature: featureCode
        });
      }

      // Attach feature info to request
      req.feature = featureCode;
      next();
    } catch (error) {
      console.error('Error in requireFeature middleware:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
};

module.exports = requireFeature;
