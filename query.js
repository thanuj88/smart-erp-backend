const Database = require('better-sqlite3');
const db = new Database('./database/shop.db');
const query = "SELECT strftime('%b', sale_date) AS label, SUM(total) AS sales, SUM(buying_price * quantity) AS purchase FROM sales WHERE DATE(sale_date) >= DATE('now','-365 days') GROUP BY strftime('%Y-%m', sale_date) ORDER BY strftime('%Y-%m', sale_date)";
const result = db.prepare(query).all();
console.log(JSON.stringify(result, null, 2));
db.close();
