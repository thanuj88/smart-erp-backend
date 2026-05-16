const pool = require('../config/database');

/**
 * Check if user's plan has a specific feature
 * @param {number} userId - The user ID
 * @param {string} featureCode - The feature code to check
 * @returns {Promise<boolean>} True if feature is available in user's plan
 */
const hasFeature = async (userId, featureCode) => {
  try {
    const result = await pool.query(
      `SELECT pf.plan_id 
       FROM users u 
       JOIN tenants t ON u.tenant_id = t.id
       JOIN plan_features pf ON t.plan_id = pf.plan_id
       JOIN features f ON pf.feature_id = f.id
       WHERE u.id = $1 AND f.code = $2`,
      [userId, featureCode]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking feature:', error);
    return false;
  }
};

/**
 * Check if user has a specific role
 * @param {number} userId - The user ID
 * @param {string|string[]} allowedRoles - The role(s) to check
 * @returns {Promise<boolean>} True if user has one of the allowed roles
 */
const hasRole = async (userId, allowedRoles) => {
  try {
    const rolesArray = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    
    const result = await pool.query(
      `SELECT role FROM users WHERE id = $1 AND role = ANY($2)`,
      [userId, rolesArray]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking role:', error);
    return false;
  }
};

/**
 * Check if user can access a feature based on both feature availability and role
 * @param {number} userId - The user ID
 * @param {string} featureCode - The feature code
 * @param {string|string[]} requiredRole - The role(s) required for this feature
 * @returns {Promise<boolean>} True if user has both feature access and required role
 */
const canAccess = async (userId, featureCode, requiredRole) => {
  try {
    const hasFeatureAccess = await hasFeature(userId, featureCode);
    if (!hasFeatureAccess) {
      return false;
    }

    const hasRequiredRole = await hasRole(userId, requiredRole);
    return hasRequiredRole;
  } catch (error) {
    console.error('Error in canAccess:', error);
    return false;
  }
};

/**
 * Get all features available to a user
 * @param {number} userId - The user ID
 * @returns {Promise<Array>} Array of available features
 */
const getUserFeatures = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT f.code, f.name 
       FROM users u 
       JOIN tenants t ON u.tenant_id = t.id
       JOIN plan_features pf ON t.plan_id = pf.plan_id
       JOIN features f ON pf.feature_id = f.id
       WHERE u.id = $1
       ORDER BY f.name`,
      [userId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting user features:', error);
    return [];
  }
};

/**
 * Get user with full authorization context
 * @param {number} userId - The user ID
 * @returns {Promise<Object>} User object with role, tenantId, and plan info
 */
const getUserWithContext = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT 
        u.id, 
        u.username, 
        u.role, 
        u.tenant_id,
        t.name as tenant_name,
        t.plan_id,
        p.name as plan_name,
        p.type as plan_type
       FROM users u 
       JOIN tenants t ON u.tenant_id = t.id
       JOIN plans p ON t.plan_id = p.id
       WHERE u.id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }

    const user = result.rows[0];
    const features = await getUserFeatures(userId);

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      tenantId: user.tenant_id,
      tenantName: user.tenant_name,
      planId: user.plan_id,
      planName: user.plan_name,
      planType: user.plan_type,
      features: features.map(f => f.code)
    };
  } catch (error) {
    console.error('Error getting user context:', error);
    return null;
  }
};

module.exports = {
  hasFeature,
  hasRole,
  canAccess,
  getUserFeatures,
  getUserWithContext
};
