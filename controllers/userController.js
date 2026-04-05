const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Get all users (Admin only)
const getAllUsers = (req, res) => {
  try {
    const users = User.getAll();
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Create new user (Admin only)
const createUser = async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Username, password, and role are required' });
    }

    if (!['admin', 'teller'].includes(role)) {
      return res.status(400).json({ error: 'Role must be either "admin" or "teller"' });
    }

    const existingUser = User.findByUsername(username);

    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = User.create(username, hashedPassword, role);
    const newUser = User.findById(userId);

    res.status(201).json(newUser);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Update user (Admin only)
const updateUser = (req, res) => {
  try {
    const { username, role } = req.body;
    const userId = req.params.id;

    const user = User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (role && !['admin', 'teller'].includes(role)) {
      return res.status(400).json({ error: 'Role must be either "admin" or "teller"' });
    }

    User.update(
      userId,
      username || user.username,
      role || user.role
    );

    const updatedUser = User.findById(userId);
    res.json(updatedUser);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Delete user (Admin only)
const deleteUser = (req, res) => {
  try {
    const userId = req.params.id;

    // Prevent deleting self
    if (userId == req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const user = User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    User.delete(userId);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllUsers,
  createUser,
  updateUser,
  deleteUser
};
