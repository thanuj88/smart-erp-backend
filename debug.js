const Database = require('better-sqlite3');
const db = new Database('./database/shop.db');
const query = "SELECT sale_date, strftime('%b', sale_date) AS label, strftime('%Y-%m', sale_date) AS month_group FROM sales LIMIT 5";
const result = db.prepare(query).all();
console.log('Sample dates:');
console.log(JSON.stringify(result, null, 2));
db.close();
