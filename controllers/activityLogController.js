const activityLog = require('../services/activityLogService');
const { resolveTenantId } = require('../utils/tenant');

const list = async (req, res) => {
  try {
    const result = await activityLog.list(resolveTenantId(req), {
      from: req.query.from,
      to: req.query.to,
      action: req.query.action,
      userId: req.query.userId,
      email: req.query.email,
      limit: req.query.limit,
      cursor: req.query.cursor,
    });
    res.json(result);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Activity log error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { list };
