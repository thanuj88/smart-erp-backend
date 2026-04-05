const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/config');

const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      username: user.username, 
      role: user.role 
    },
    jwtSecret,
    { expiresIn: '24h' }
  );
};

module.exports = { generateToken };
