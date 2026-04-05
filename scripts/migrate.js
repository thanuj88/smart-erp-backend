const db = require('../config/db');

// Migration to add category_id column to items table
function migrate() {
  console.log('Running migration to add category_id to items table...');

  try {
    // Check if category_id column already exists
    const tableInfo = db.pragma('table_info(items)');
    const categoryIdExists = tableInfo.some(col => col.name === 'category_id');

    if (!categoryIdExists) {
      db.exec('ALTER TABLE items ADD COLUMN category_id INTEGER REFERENCES categories(id)');
      console.log('✓ Added category_id column to items table');
    } else {
      console.log('✓ category_id column already exists in items table');
    }

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  }
}

// Run migration
if (require.main === module) {
  migrate();
  process.exit(0);
}

module.exports = migrate;
