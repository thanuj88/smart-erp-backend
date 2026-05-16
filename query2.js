const Database = require('better-sqlite3');
const db = new Database('./database/shop.db');

// Function to convert month number to abbreviated name
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const query = "SELECT strftime('%m', sale_date) AS month_num, SUM(total) AS sales, SUM(buying_price * quantity) AS purchase FROM sales WHERE DATE(sale_date) >= DATE('now','-365 days') GROUP BY strftime('%Y-%m', sale_date) ORDER BY strftime('%Y-%m', sale_date)";
const result = db.prepare(query).all();

// Convert month numbers to abbreviated names
const formattedResult = result.map(row => ({
  label: monthNames[parseInt(row.month_num) - 1],
  sales: row.sales,
  purchase: row.purchase
}));

console.log(JSON.stringify(formattedResult, null, 2));
db.close();
