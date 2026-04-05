const db = require('../config/db');
const bcrypt = require('bcryptjs');

// Initialize database schema
function initDatabase() {
  console.log('Initializing database...');

  // Create Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'teller')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Categories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      icon TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Items table (with buying and selling prices)
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      buying_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      category TEXT,
      category_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )
  `);

  // Create Installment Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS installment_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      months INTEGER UNIQUE NOT NULL,
      interest_rate REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Customers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      id_card_no TEXT NOT NULL,
      email TEXT,
      address TEXT NOT NULL,
      id_image_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Witnesses table
  db.exec(`
    CREATE TABLE IF NOT EXISTS witnesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      id_card_no TEXT NOT NULL,
      address TEXT NOT NULL,
      id_image_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Sales table (enhanced with payment types)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      buying_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL,
      price REAL NOT NULL,
      total REAL NOT NULL,
      profit REAL NOT NULL DEFAULT 0,
      payment_type TEXT NOT NULL DEFAULT 'cash' CHECK(payment_type IN ('cash', 'installment')),
      customer_id INTEGER,
      teller_id INTEGER NOT NULL,
      teller_name TEXT NOT NULL,
      sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (teller_id) REFERENCES users(id)
    )
  `);

  // Create Installment Plans table
  db.exec(`
    CREATE TABLE IF NOT EXISTS installment_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      witness_id INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      down_payment REAL NOT NULL,
      remaining_amount REAL NOT NULL,
      interest_rate REAL NOT NULL,
      interest_amount REAL NOT NULL,
      total_with_interest REAL NOT NULL,
      installment_months INTEGER NOT NULL,
      monthly_payment REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'defaulted')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (witness_id) REFERENCES witnesses(id)
    )
  `);

  // Create Installment Payments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS installment_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      installment_plan_id INTEGER NOT NULL,
      payment_number INTEGER NOT NULL,
      amount_due REAL NOT NULL,
      amount_paid REAL NOT NULL DEFAULT 0,
      due_date DATE NOT NULL,
      paid_date DATETIME,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'overdue')),
      notes TEXT,
      FOREIGN KEY (installment_plan_id) REFERENCES installment_plans(id)
    )
  `);

  console.log('Database schema created successfully!');

  // Initialize default installment settings
  const settings3Months = db.prepare('SELECT * FROM installment_settings WHERE months = ?').get(3);
  const settings6Months = db.prepare('SELECT * FROM installment_settings WHERE months = ?').get(6);
  const settings12Months = db.prepare('SELECT * FROM installment_settings WHERE months = ?').get(12);

  if (!settings3Months) {
    db.prepare('INSERT INTO installment_settings (months, interest_rate) VALUES (?, ?)').run(3, 5.0);
    console.log('Default 3-month installment settings created (5% interest)');
  }

  if (!settings6Months) {
    db.prepare('INSERT INTO installment_settings (months, interest_rate) VALUES (?, ?)').run(6, 10.0);
    console.log('Default 6-month installment settings created (10% interest)');
  }

  if (!settings12Months) {
    db.prepare('INSERT INTO installment_settings (months, interest_rate) VALUES (?, ?)').run(12, 15.0);
    console.log('Default 12-month installment settings created (15% interest)');
  }

  // Check if admin exists
  const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  
  if (!adminExists) {
    // Create default admin user
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hashedPassword, 'admin');
    console.log('Default admin user created (username: admin, password: admin123)');
  }

  // Check if teller exists
  const tellerExists = db.prepare('SELECT * FROM users WHERE username = ?').get('teller');
  
  if (!tellerExists) {
    // Create default teller user
    const hashedPassword = bcrypt.hashSync('teller123', 10);
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('teller', hashedPassword, 'teller');
    console.log('Default teller user created (username: teller, password: teller123)');
  }

  console.log('Database initialization complete!');
}

// Run initialization
if (require.main === module) {
  initDatabase();
  process.exit(0);
}

module.exports = initDatabase;
