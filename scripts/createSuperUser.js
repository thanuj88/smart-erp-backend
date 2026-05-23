#!/usr/bin/env node

/**
 * Create Super User Account Script
 * 
 * This script creates a SUPER_ADMIN user account in the database.
 * 
 * Usage:
 *   node scripts/createSuperUser.js [options]
 * 
 * Options:
 *   --username <username>     Super admin username (default: superadmin)
 *   --password <password>     Super admin password (default: SuperAdmin@123)
 *   --email <email>           Super admin email (default: superadmin@shopinventory.com)
 *   --force                   Overwrite if user already exists
 */

const pool = require('../config/database');
const crypto = require('crypto');

// Simple password hashing (in production, use bcrypt)
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function createSuperUser(options = {}) {
  const username = options.username || 'superadmin';
  const password = options.password || 'SuperAdmin@123';
  const email = options.email || 'superadmin@shopinventory.com';
  const force = options.force || false;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if user already exists
    const existingUser = await client.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0 && !force) {
      console.log(`❌ User "${username}" already exists. Use --force flag to overwrite.`);
      return false;
    }

    if (existingUser.rows.length > 0 && force) {
      await client.query('DELETE FROM users WHERE username = $1', [username]);
      console.log(`🔄 Deleted existing user "${username}"`);
    }

    // Hash password
    const passwordHash = hashPassword(password);

    // Create system tenant for super admin if it doesn't exist
    let tenantId = 1; // Default tenant ID
    const systemTenant = await client.query(
      'SELECT id FROM tenants WHERE name = $1',
      ['SYSTEM']
    );

    if (systemTenant.rows.length === 0) {
      const newTenant = await client.query(
        `INSERT INTO tenants (name, status, created_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         RETURNING id`,
        ['SYSTEM', 'ACTIVE']
      );
      tenantId = newTenant.rows[0].id;
      console.log(`📝 Created SYSTEM tenant with ID: ${tenantId}`);
    } else {
      tenantId = systemTenant.rows[0].id;
    }

    // Create super admin user
    const result = await client.query(
      `INSERT INTO users 
       (tenant_id, username, email, password_hash, role, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       RETURNING id, username, email, role`,
      [tenantId, username, email, passwordHash, 'SUPER_ADMIN', 'ACTIVE']
    );

    await client.query('COMMIT');

    const user = result.rows[0];
    
    console.log(`\n✅ Super Admin User Created Successfully!\n`);
    console.log(`${'='.repeat(50)}`);
    console.log(`📋 User Details:`);
    console.log(`${'='.repeat(50)}`);
    console.log(`  Username: ${username}`);
    console.log(`  Password: ${password}`);
    console.log(`  Email:    ${email}`);
    console.log(`  Role:     ${user.role}`);
    console.log(`  Status:   ACTIVE`);
    console.log(`${'='.repeat(50)}`);
    console.log(`\n💾 Credentials saved. Use these to login.`);
    console.log(`\n⚠️  IMPORTANT: Store these credentials securely!`);
    console.log(`   → Change password after first login`);
    console.log(`   → Do not share with unauthorized users`);
    console.log(`   → Keep login credentials safe\n`);

    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error creating super user:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================
// CLI Entry Point
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const options = {
    username: 'superadmin',
    password: 'SuperAdmin@123',
    email: 'superadmin@shopinventory.com',
    force: false
  };

  // Parse CLI arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && args[i + 1]) {
      options.username = args[i + 1];
      i++;
    } else if (args[i] === '--password' && args[i + 1]) {
      options.password = args[i + 1];
      i++;
    } else if (args[i] === '--email' && args[i + 1]) {
      options.email = args[i + 1];
      i++;
    } else if (args[i] === '--force') {
      options.force = true;
    }
  }

  console.log(`
╔════════════════════════════════════════════════════════════╗
║   Create Super Admin User                                  ║
║   Shop Inventory System                                    ║
╚════════════════════════════════════════════════════════════╝
  `);

  try {
    await createSuperUser(options);
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
