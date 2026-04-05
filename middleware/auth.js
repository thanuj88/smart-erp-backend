const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/config');
const User = require('../models/User');

// Verify JWT token
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Check if user has admin role
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin role required.' });
  }
  next();
};

// Check if user has teller or admin role
const requireTeller = (req, res, next) => {
  if (req.user.role !== 'teller' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Teller role required.' });
  }
  next();
};

module.exports = {
  authenticate,
  requireAdmin,
  requireTeller
};
