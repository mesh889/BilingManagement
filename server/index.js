const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const billing = require('./bill');
const tenant = require('./tenant');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const dbPath = path.join(__dirname, 'bills.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Billing APIs use the existing /api/... routes.
billing(app, db);

// Tenant/Rent APIs use /api/tenant/...
tenant(app, db);

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`SQLite database: ${dbPath}`);
});
