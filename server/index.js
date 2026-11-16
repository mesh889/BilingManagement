const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const billing = require('./bill');
const tenant = require('./tenant');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================
// DATABASE
// ============================================

const dbPath = path.join(__dirname, 'bills.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================
// API ROUTES
// ============================================

// Billing APIs
billing(app, db);

// Tenant/Rent APIs
tenant(app, db);

// ============================================
// ANGULAR FRONTEND
// ============================================

// Angular production build location
const frontendPath = path.join(
  __dirname,
  '..',
  'dist',
  'bill-management',
  'browser'
);

// Serve Angular static files
app.use(express.static(frontendPath));

// Angular route fallback
// This allows routes such as /bills and /bills/edit/123
// to work correctly when the page is refreshed.
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ============================================
// SERVER
// ============================================

const PORT = 3000;

app.listen(PORT, () => {
  console.log('============================================');
  console.log('  Bill Management Server');
  console.log('============================================');
  console.log(`Server:   http://localhost:${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Angular:  ${frontendPath}`);
  console.log('============================================');
});