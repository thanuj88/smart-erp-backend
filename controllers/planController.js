const pool = require('../config/database');

/**
 * Create a new plan (SUPER_ADMIN only)
 */
const createPlan = async (req, res) => {
  const { name, type, price, description } = req.body;

  // Validate inputs
  if (!name || !type || price === undefined) {
    return res.status(400).json({ error: 'Missing required fields: name, type, price' });
  }

  if (!['PLAN_A', 'PLAN_B'].includes(type)) {
    return res.status(400).json({ error: 'Invalid plan type. Must be PLAN_A or PLAN_B' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO plans (name, type, price, description) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, name, type, price, description, created_at`,
      [name, type, price, description || null]
    );

    res.status(201).json({
      message: 'Plan created successfully',
      plan: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating plan:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Plan type already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get all plans
 */
const getPlans = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, COUNT(pf.feature_id) as feature_count
       FROM plans p
       LEFT JOIN plan_features pf ON p.id = pf.plan_id
       GROUP BY p.id
       ORDER BY p.created_at DESC`
    );

    res.json({ plans: result.rows });
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get plan by ID with features
 */
const getPlanById = async (req, res) => {
  const { id } = req.params;

  try {
    const planResult = await pool.query(
      `SELECT * FROM plans WHERE id = $1`,
      [id]
    );

    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const featuresResult = await pool.query(
      `SELECT f.id, f.code, f.name, f.description
       FROM features f
       JOIN plan_features pf ON f.id = pf.feature_id
       WHERE pf.plan_id = $1
       ORDER BY f.name`,
      [id]
    );

    res.json({
      plan: planResult.rows[0],
      features: featuresResult.rows
    });
  } catch (error) {
    console.error('Error fetching plan:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update plan (SUPER_ADMIN only)
 */
const updatePlan = async (req, res) => {
  const { id } = req.params;
  const { name, price, description } = req.body;

  try {
    const result = await pool.query(
      `UPDATE plans 
       SET name = COALESCE($1, name), 
           price = COALESCE($2, price),
           description = COALESCE($3, description),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [name || null, price || null, description || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json({
      message: 'Plan updated successfully',
      plan: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating plan:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete plan (SUPER_ADMIN only)
 */
const deletePlan = async (req, res) => {
  const { id } = req.params;

  try {
    // Check if any tenants use this plan
    const tenantsResult = await pool.query(
      `SELECT COUNT(*) as count FROM tenants WHERE plan_id = $1`,
      [id]
    );

    if (parseInt(tenantsResult.rows[0].count) > 0) {
      return res.status(409).json({ 
        error: 'Cannot delete plan with active tenants',
        activeCount: parseInt(tenantsResult.rows[0].count)
      });
    }

    const result = await pool.query(
      `DELETE FROM plans WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json({ message: 'Plan deleted successfully' });
  } catch (error) {
    console.error('Error deleting plan:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Add feature to plan (SUPER_ADMIN only)
 */
const addFeatureToPlan = async (req, res) => {
  const { planId } = req.params;
  const { featureCode } = req.body;

  if (!featureCode) {
    return res.status(400).json({ error: 'featureCode is required' });
  }

  try {
    // Get feature ID
    const featureResult = await pool.query(
      `SELECT id FROM features WHERE code = $1`,
      [featureCode]
    );

    if (featureResult.rows.length === 0) {
      return res.status(404).json({ error: 'Feature not found' });
    }

    const featureId = featureResult.rows[0].id;

    // Add feature to plan
    try {
      await pool.query(
        `INSERT INTO plan_features (plan_id, feature_id) VALUES ($1, $2)`,
        [planId, featureId]
      );

      res.status(201).json({ message: 'Feature added to plan successfully' });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Feature already assigned to this plan' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Error adding feature to plan:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Remove feature from plan (SUPER_ADMIN only)
 */
const removeFeatureFromPlan = async (req, res) => {
  const { planId, featureId } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM plan_features WHERE plan_id = $1 AND feature_id = $2`,
      [planId, featureId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Feature assignment not found' });
    }

    res.json({ message: 'Feature removed from plan successfully' });
  } catch (error) {
    console.error('Error removing feature from plan:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get all features
 */
const getFeatures = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM features ORDER BY name`
    );

    res.json({ features: result.rows });
  } catch (error) {
    console.error('Error fetching features:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Create a new feature (SUPER_ADMIN only)
 */
const createFeature = async (req, res) => {
  const { code, name, description } = req.body;

  if (!code || !name) {
    return res.status(400).json({ error: 'Missing required fields: code, name' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO features (code, name, description) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [code, name, description || null]
    );

    res.status(201).json({
      message: 'Feature created successfully',
      feature: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating feature:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Feature code already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get analytics: total tenants, user count by plan, revenue
 */
const getAnalytics = async (req, res) => {
  try {
    // Total tenants
    const tenantsResult = await pool.query(`SELECT COUNT(*) as count FROM tenants`);
    
    // Users by plan
    const usersByPlanResult = await pool.query(`
      SELECT p.name, p.type, COUNT(u.id) as user_count
      FROM plans p
      JOIN tenants t ON p.id = t.plan_id
      LEFT JOIN users u ON t.id = u.tenant_id
      GROUP BY p.id, p.name, p.type
      ORDER BY p.name
    `);

    // Revenue by plan
    const revenueResult = await pool.query(`
      SELECT p.name, p.type, p.price, COUNT(t.id) as active_tenants, 
             (p.price * COUNT(t.id)) as total_revenue
      FROM plans p
      LEFT JOIN tenants t ON p.id = t.plan_id
      GROUP BY p.id, p.name, p.type, p.price
      ORDER BY total_revenue DESC
    `);

    res.json({
      totalTenants: parseInt(tenantsResult.rows[0].count),
      usersByPlan: usersByPlanResult.rows,
      revenueByPlan: revenueResult.rows
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createPlan,
  getPlans,
  getPlanById,
  updatePlan,
  deletePlan,
  addFeatureToPlan,
  removeFeatureFromPlan,
  getFeatures,
  createFeature,
  getAnalytics
};
