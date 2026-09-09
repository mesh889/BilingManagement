const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ===== Backup Folder Setup =====
const BACKUP_DIR = path.join(__dirname, 'backups');
const MAX_BACKUPS = 10;
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

// ===== Auto Backup Helper =====
function createAutoBackup(reason) {
  const billRows = db.prepare('SELECT * FROM bills ORDER BY id').all();
  const purchaseRows = db.prepare('SELECT * FROM purchases ORDER BY id').all();
  if (billRows.length === 0 && purchaseRows.length === 0) return null;
  const backup = {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    reason: reason || 'manual',
    totalBills: billRows.length,
    totalPurchases: purchaseRows.length,
    bills: billRows.map(buildBill),
    purchases: purchaseRows,
  };
  return saveBackupToFolder(backup);
}

// ===== SQLite Setup =====
const dbPath = path.join(__dirname, 'bills.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===== Create Tables =====
db.exec(`
  CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    billNumber TEXT NOT NULL,
    billDate TEXT NOT NULL,
    buyerName TEXT, buyerGstNo TEXT, buyerPan TEXT, buyerAddress TEXT, buyerPhone TEXT,
    supplierName TEXT, supplierGstNo TEXT, supplierPan TEXT, supplierAddress TEXT, supplierPhone TEXT,
    bankName TEXT, accountNumber TEXT, ifscCode TEXT,
    totalAmount REAL DEFAULT 0,
    totalGst REAL DEFAULT 0,
    grandTotal REAL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bill_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    billId INTEGER NOT NULL,
    srNo INTEGER,
    description TEXT,
    hsnSac TEXT,
    unit REAL DEFAULT 0,
    quantity REAL DEFAULT 0,
    rate REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    cgstPercent REAL DEFAULT 0,
    sgstPercent REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    FOREIGN KEY (billId) REFERENCES bills(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoiceNo TEXT NOT NULL,
    invoiceDate TEXT NOT NULL,
    name TEXT,
    gstNo TEXT,
    taxableAmount REAL DEFAULT 0,
    cgst REAL DEFAULT 0,
    sgst REAL DEFAULT 0,
    totalWithTax REAL DEFAULT 0,
    totalWithoutTax REAL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now'))
  );
`);

// ===== Helper: calc item amount =====
function calcAmount(item) {
  const qty = item.quantity || 0;
  const rate = item.rate || 0;
  const disc = item.discount || 0;
  const base = qty * rate;
  const afterDisc = base - (base * disc) / 100;
  const cgst = (afterDisc * (item.cgstPercent || 0)) / 100;
  const sgst = (afterDisc * (item.sgstPercent || 0)) / 100;
  return +(afterDisc + cgst + sgst).toFixed(2);
}

function calcTotals(items) {
  let totalAmount = 0, totalGst = 0;
  items.forEach(i => {
    const base = (i.quantity || 0) * (i.rate || 0);
    const taxable = base - (base * (i.discount || 0)) / 100;
    totalAmount += taxable;
    totalGst += (taxable * (i.cgstPercent || 0)) / 100 + (taxable * (i.sgstPercent || 0)) / 100;
  });
  return { totalAmount: +totalAmount.toFixed(2), totalGst: +totalGst.toFixed(2), grandTotal: +(totalAmount + totalGst).toFixed(2) };
}

// ===== Helper: build bill JSON from DB row =====
function buildBill(row) {
  const items = db.prepare('SELECT * FROM bill_items WHERE billId = ? ORDER BY srNo').all(row.id);
  return {
    id: String(row.id),
    billNumber: row.billNumber,
    billDate: row.billDate,
    buyer: { name: row.buyerName, gstNo: row.buyerGstNo, pan: row.buyerPan, address: row.buyerAddress, phone: row.buyerPhone },
    supplier: { name: row.supplierName, gstNo: row.supplierGstNo, pan: row.supplierPan, address: row.supplierAddress, phone: row.supplierPhone, bankName: row.bankName, accountNumber: row.accountNumber, ifscCode: row.ifscCode },
    items: items.map(i => ({
      srNo: i.srNo, description: i.description, hsnSac: i.hsnSac, unit: i.unit,
      quantity: i.quantity, rate: i.rate, discount: i.discount,
      cgstPercent: i.cgstPercent, sgstPercent: i.sgstPercent, amount: i.amount,
    })),
    bankDetails: { bankName: row.bankName, accountNumber: row.accountNumber, ifscCode: row.ifscCode },
    totalAmount: row.totalAmount, totalGst: row.totalGst, grandTotal: row.grandTotal,
  };
}

// ===== Helper: insert/update bill =====
function saveBillToDB(bill, existingId) {
  bill.items.forEach(i => { i.amount = calcAmount(i); });
  const totals = calcTotals(bill.items);

  if (existingId) {
    db.prepare(`UPDATE bills SET billNumber=?, billDate=?,
      buyerName=?, buyerGstNo=?, buyerPan=?, buyerAddress=?, buyerPhone=?,
      supplierName=?, supplierGstNo=?, supplierPan=?, supplierAddress=?, supplierPhone=?,
      bankName=?, accountNumber=?, ifscCode=?,
      totalAmount=?, totalGst=?, grandTotal=?, updatedAt=datetime('now')
      WHERE id=?`).run(
      bill.billNumber, bill.billDate,
      bill.buyer?.name, bill.buyer?.gstNo, bill.buyer?.pan, bill.buyer?.address, bill.buyer?.phone,
      bill.supplier?.name, bill.supplier?.gstNo, bill.supplier?.pan, bill.supplier?.address, bill.supplier?.phone,
      bill.bankDetails?.bankName, bill.bankDetails?.accountNumber, bill.bankDetails?.ifscCode,
      totals.totalAmount, totals.totalGst, totals.grandTotal, existingId
    );
    db.prepare('DELETE FROM bill_items WHERE billId = ?').run(existingId);
    const insertItem = db.prepare(`INSERT INTO bill_items (billId, srNo, description, hsnSac, unit, quantity, rate, discount, cgstPercent, sgstPercent, amount) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    bill.items.forEach(i => insertItem.run(existingId, i.srNo, i.description, i.hsnSac, i.unit, i.quantity, i.rate, i.discount, i.cgstPercent, i.sgstPercent, i.amount));
    return existingId;
  } else {
    const result = db.prepare(`INSERT INTO bills (billNumber, billDate,
      buyerName, buyerGstNo, buyerPan, buyerAddress, buyerPhone,
      supplierName, supplierGstNo, supplierPan, supplierAddress, supplierPhone,
      bankName, accountNumber, ifscCode, totalAmount, totalGst, grandTotal)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      bill.billNumber, bill.billDate,
      bill.buyer?.name, bill.buyer?.gstNo, bill.buyer?.pan, bill.buyer?.address, bill.buyer?.phone,
      bill.supplier?.name, bill.supplier?.gstNo, bill.supplier?.pan, bill.supplier?.address, bill.supplier?.phone,
      bill.bankDetails?.bankName, bill.bankDetails?.accountNumber, bill.bankDetails?.ifscCode,
      totals.totalAmount, totals.totalGst, totals.grandTotal
    );
    const billId = result.lastInsertRowid;
    const insertItem = db.prepare(`INSERT INTO bill_items (billId, srNo, description, hsnSac, unit, quantity, rate, discount, cgstPercent, sgstPercent, amount) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    bill.items.forEach(i => insertItem.run(billId, i.srNo, i.description, i.hsnSac, i.unit, i.quantity, i.rate, i.discount, i.cgstPercent, i.sgstPercent, i.amount));
    return billId;
  }
}

// ===== Seed Data (only if DB is empty) =====
const count = db.prepare('SELECT COUNT(*) as cnt FROM bills').get().cnt;
if (count === 0) {
  console.log('Seeding database...');
  const seedBills = [
    {
      billNumber: 'BILL-20250115-0001', billDate: '2025-01-15',
      buyer: { name: 'ABC Traders Pvt Ltd', gstNo: '27ABCDE1234F1Z5', pan: 'ABCDE1234F', address: '123 MG Road, Mumbai', phone: '9876543210' },
      supplier: { name: 'XYZ Suppliers India', gstNo: '07XYZAB5678G1Z3', pan: 'XYZAB5678G', address: '456 Park Street, Delhi', phone: '9123456780' },
      items: [
        { srNo: 1, description: 'Steel Rods 12mm', hsnSac: '7214', unit: 1, quantity: 100, rate: 450, discount: 5, cgstPercent: 9, sgstPercent: 9 },
        { srNo: 2, description: 'Cement Bags 50kg', hsnSac: '2523', unit: 1, quantity: 200, rate: 350, discount: 0, cgstPercent: 14, sgstPercent: 14 },
        { srNo: 3, description: 'Sand (per ton)', hsnSac: '2505', unit: 1, quantity: 50, rate: 800, discount: 2, cgstPercent: 2.5, sgstPercent: 2.5 },
      ],
      bankDetails: { bankName: 'State Bank of India', accountNumber: '1234567890', ifscCode: 'SBIN0001234' },
    },
    {
      billNumber: 'BILL-20250210-0002', billDate: '2025-02-10',
      buyer: { name: 'PQR Enterprises', gstNo: '27PQRST6789H1Z8', pan: 'PQRST6789H', address: '789 Nehru Nagar, Pune', phone: '9988776655' },
      supplier: { name: 'LMN Industries Ltd', gstNo: '33LMNOP1234I1Z2', pan: 'LMNOP1234I', address: '321 Industrial Area, Chennai', phone: '9112233445' },
      items: [
        { srNo: 1, description: 'Copper Wire 2.5mm', hsnSac: '7408', unit: 1, quantity: 500, rate: 120, discount: 3, cgstPercent: 9, sgstPercent: 9 },
        { srNo: 2, description: 'PVC Pipes 4 inch', hsnSac: '3917', unit: 1, quantity: 300, rate: 250, discount: 0, cgstPercent: 9, sgstPercent: 9 },
      ],
      bankDetails: { bankName: 'HDFC Bank', accountNumber: '9876543210', ifscCode: 'HDFC0002345' },
    },
    {
      billNumber: 'BILL-20250305-0003', billDate: '2025-03-05',
      buyer: { name: 'Global Tech Solutions', gstNo: '29GTECH7890J1Z6', pan: 'GTECH7890J', address: '55 IT Park, Bangalore', phone: '9001122334' },
      supplier: { name: 'ABC Traders Pvt Ltd', gstNo: '27ABCDE1234F1Z5', pan: 'ABCDE1234F', address: '123 MG Road, Mumbai', phone: '9876543210' },
      items: [
        { srNo: 1, description: 'Laptop Stand', hsnSac: '8473', unit: 1, quantity: 50, rate: 1200, discount: 10, cgstPercent: 9, sgstPercent: 9 },
      ],
      bankDetails: { bankName: 'ICICI Bank', accountNumber: '5566778899', ifscCode: 'ICIC0003456' },
    },
    {
      billNumber: 'BILL-20250412-0004', billDate: '2025-04-12',
      buyer: { name: 'Sunrise Exports', gstNo: '24SUNRS4567K1Z1', pan: 'SUNRS4567K', address: '99 Export Zone, Surat', phone: '9445566778' },
      supplier: { name: 'XYZ Suppliers India', gstNo: '07XYZAB5678G1Z3', pan: 'XYZAB5678G', address: '456 Park Street, Delhi', phone: '9123456780' },
      items: [
        { srNo: 1, description: 'Cotton Fabric Roll', hsnSac: '5208', unit: 1, quantity: 1000, rate: 150, discount: 5, cgstPercent: 2.5, sgstPercent: 2.5 },
        { srNo: 2, description: 'Silk Thread Bundle', hsnSac: '5004', unit: 1, quantity: 500, rate: 200, discount: 0, cgstPercent: 2.5, sgstPercent: 2.5 },
      ],
      bankDetails: { bankName: 'Bank of Baroda', accountNumber: '1122334455', ifscCode: 'BARB0004567' },
    },
    {
      billNumber: 'BILL-20250520-0005', billDate: '2025-05-20',
      buyer: { name: 'Shree Ganesh Construction Pvt Ltd', gstNo: '27SGCPL1234M1Z4', pan: 'SGCPL1234M', address: '12/A, Laxmi Nagar, Near Railway Station, Nagpur - 440001, Maharashtra', phone: '9823456789' },
      supplier: { name: 'Bharat Building Materials & Hardware Suppliers', gstNo: '27BBMHS5678N1Z7', pan: 'BBMHS5678N', address: '45, Industrial Estate, MIDC Road, Pune - 411018, Maharashtra', phone: '9145678901' },
      items: [
        { srNo: 1, description: 'TMT Steel Bars 8mm Fe500D', hsnSac: '7214', unit: 1, quantity: 500, rate: 65, discount: 2, cgstPercent: 9, sgstPercent: 9 },
        { srNo: 2, description: 'TMT Steel Bars 12mm Fe500D', hsnSac: '7214', unit: 1, quantity: 800, rate: 62, discount: 2, cgstPercent: 9, sgstPercent: 9 },
        { srNo: 3, description: 'TMT Steel Bars 16mm Fe500D', hsnSac: '7214', unit: 1, quantity: 600, rate: 60, discount: 3, cgstPercent: 9, sgstPercent: 9 },
        { srNo: 4, description: 'Ultratech OPC Cement 53 Grade', hsnSac: '2523', unit: 1, quantity: 400, rate: 380, discount: 0, cgstPercent: 14, sgstPercent: 14 },
        { srNo: 5, description: 'ACC PPC Cement', hsnSac: '2523', unit: 1, quantity: 300, rate: 350, discount: 5, cgstPercent: 14, sgstPercent: 14 },
        { srNo: 6, description: 'River Sand (Fine Grade)', hsnSac: '2505', unit: 1, quantity: 25, rate: 1800, discount: 0, cgstPercent: 2.5, sgstPercent: 2.5 },
        { srNo: 7, description: 'Crushed Stone Aggregate 20mm', hsnSac: '2505', unit: 1, quantity: 30, rate: 1200, discount: 0, cgstPercent: 2.5, sgstPercent: 2.5 },
      ],
      bankDetails: { bankName: 'Bank of Maharashtra', accountNumber: '60325478901', ifscCode: 'MAHB0001234' },
    },
  ];
  const seedTx = db.transaction(() => { seedBills.forEach(b => saveBillToDB(b)); });
  seedTx();
  console.log('Seeded 5 bills.');
}

// Auto backup on server startup
const startupBackup = createAutoBackup('server-startup');
if (startupBackup) console.log('Startup backup saved:', startupBackup.filename);
else console.log('No bills to backup on startup.');

// ===== API Routes =====

// ===== API Routes =====

// GET all bills
app.get('/api/bills', (req, res) => {
  const rows = db.prepare('SELECT * FROM bills ORDER BY id DESC').all();
  res.json(rows.map(buildBill));
});

// GET bill by id
app.get('/api/bills/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Bill not found' });
  res.json(buildBill(row));
});

// POST create bill
app.post('/api/bills', (req, res) => {
  const billId = saveBillToDB(req.body);
  const row = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
  res.status(201).json(buildBill(row));
});

// PUT update bill
app.put('/api/bills/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Bill not found' });
  saveBillToDB(req.body, req.params.id);
  const row = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  res.json(buildBill(row));
});

// DELETE bill
app.delete('/api/bills/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Bill not found' });
  db.prepare('DELETE FROM bills WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET unique buyers
app.get('/api/parties/buyers', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT buyerName as name, buyerGstNo as gstNo, buyerPan as pan, buyerAddress as address, buyerPhone as phone FROM bills WHERE buyerName IS NOT NULL').all();
  res.json(rows);
});

// GET unique suppliers
app.get('/api/parties/suppliers', (req, res) => {
  const rows = db.prepare(`SELECT DISTINCT supplierName as name, supplierGstNo as gstNo, supplierPan as pan, 
    supplierAddress as address, supplierPhone as phone, 
    bankName, accountNumber, ifscCode 
    FROM bills WHERE supplierName IS NOT NULL`).all();
  res.json(rows);
});

// ===== Raw SQL Query API =====
app.post('/api/query/execute', (req, res) => {
  const { sql } = req.body;
  if (!sql || !sql.trim()) return res.status(400).json({ error: 'SQL query is required' });

  try {
    const trimmed = sql.trim().toUpperCase();
    let result;
    if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('EXPLAIN')) {
      result = db.prepare(sql).all();
    } else {
      result = db.prepare(sql).run();
    }
    res.json({ sql, executedAt: new Date().toISOString(), rowCount: Array.isArray(result) ? result.length : result.changes, result });
  } catch (err) {
    res.status(400).json({ error: err.message, sql });
  }
});

// GET table schema info
app.get('/api/query/tables', (req, res) => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const schema = {};
  tables.forEach(t => {
    schema[t.name] = db.prepare(`PRAGMA table_info(${t.name})`).all();
  });
  res.json(schema);
});

const PORT = 3000;

// ===== Purchase CRUD APIs =====
app.get('/api/purchases', (req, res) => {
  res.json(db.prepare('SELECT * FROM purchases ORDER BY id DESC').all());
});

app.get('/api/purchases/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Purchase not found' });
  res.json(row);
});

app.post('/api/purchases', (req, res) => {
  const p = req.body;
  const taxable = +(p.taxableAmount || 0);
  const cgst = +(p.cgst || 0);
  const sgst = +(p.sgst || 0);
  const result = db.prepare(`INSERT INTO purchases (invoiceNo, invoiceDate, name, gstNo, taxableAmount, cgst, sgst, totalWithTax, totalWithoutTax)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    p.invoiceNo, p.invoiceDate, p.name, p.gstNo, taxable, cgst, sgst,
    +(taxable + cgst + sgst).toFixed(2), taxable
  );
  res.status(201).json(db.prepare('SELECT * FROM purchases WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/purchases/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Purchase not found' });
  const p = req.body;
  const taxable = +(p.taxableAmount || 0);
  const cgst = +(p.cgst || 0);
  const sgst = +(p.sgst || 0);
  db.prepare(`UPDATE purchases SET invoiceNo=?, invoiceDate=?, name=?, gstNo=?, taxableAmount=?, cgst=?, sgst=?, totalWithTax=?, totalWithoutTax=? WHERE id=?`).run(
    p.invoiceNo, p.invoiceDate, p.name, p.gstNo, taxable, cgst, sgst,
    +(taxable + cgst + sgst).toFixed(2), taxable, req.params.id
  );
  res.json(db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id));
});

app.delete('/api/purchases/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Purchase not found' });
  db.prepare('DELETE FROM purchases WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===== Report API =====
app.get('/api/report', (req, res) => {

  const {
    year,
    month,
    supplier,
    fromDate,
    toDate,
    excludeProforma,
    excludeQuotation
  } = req.query;


  // ============================================================
  // HELPER
  // ============================================================

  const isTrue = (value) =>
    String(value).toLowerCase() === 'true';


  const shouldExcludeProforma =
    isTrue(excludeProforma);

  const shouldExcludeQuotation =
    isTrue(excludeQuotation);


  // ============================================================
  // SALES / BILLS
  // ============================================================

  let salesQuery = `
    SELECT
      billNumber as invoiceNo,
      billDate as invoiceDate,

      supplierName as name,
      supplierGstNo as gstNo,

      buyerName,
      buyerGstNo,

      totalAmount as taxableAmount,
      totalGst,
      grandTotal as totalWithTax,
      totalAmount as totalWithoutTax,

      substr(billDate, 1, 7) as monthKey

    FROM bills

    WHERE 1=1
  `;


  const salesParams = [];


  // ============================================================
  // YEAR
  // ============================================================

  if (year) {

    salesQuery += `
      AND substr(billDate, 1, 4) = ?
    `;

    salesParams.push(year);

  }


  // ============================================================
  // MONTH
  // ============================================================

  if (month) {

    salesQuery += `
      AND substr(billDate, 6, 2) = ?
    `;

    salesParams.push(
      String(month).padStart(2, '0')
    );

  }


  // ============================================================
  // DATE RANGE
  // ============================================================

  if (fromDate) {

    salesQuery += `
      AND billDate >= ?
    `;

    salesParams.push(fromDate);

  }


  if (toDate) {

    salesQuery += `
      AND billDate <= ?
    `;

    salesParams.push(toDate);

  }


  // ============================================================
  // SUPPLIER
  // ============================================================

  if (supplier) {

    salesQuery += `
      AND supplierName = ?
    `;

    salesParams.push(supplier);

  }


  // ============================================================
  // EXCLUDE PROFORMA
  //
  // Examples:
  // PROFARMA-20260830-9587
  // PROFORMA-20260830-123
  //
  // Case insensitive
  // ============================================================

  if (shouldExcludeProforma) {

    salesQuery += `
      AND UPPER(COALESCE(billNumber, '')) NOT LIKE '%PROFARMA%'
      AND UPPER(COALESCE(billNumber, '')) NOT LIKE '%PROFORMA%'
    `;

  }


  // ============================================================
  // EXCLUDE QUOTATION
  //
  // Examples:
  // BILL-QUOTATION1
  // QUOTATION-20260830-001
  // QUOTATIONS-001
  //
  // Case insensitive
  // ============================================================

  if (shouldExcludeQuotation) {

    salesQuery += `
      AND UPPER(COALESCE(billNumber, '')) NOT LIKE '%QUOTATION%'
      AND UPPER(COALESCE(billNumber, '')) NOT LIKE '%QUOTATIONS%'
    `;

  }


  salesQuery += `
    ORDER BY billDate DESC
  `;


  const sales =
    db.prepare(salesQuery).all(...salesParams);


  // ============================================================
  // CGST / SGST
  // ============================================================

  sales.forEach(s => {

    const gst =
      Number(s.totalGst || 0);

    s.cgst =
      +(gst / 2).toFixed(2);

    s.sgst =
      +(gst / 2).toFixed(2);

  });


  // ============================================================
  // PURCHASES
  // ============================================================

  let purchaseQuery = `
    SELECT
      invoiceNo,
      invoiceDate,

      name,
      gstNo,

      taxableAmount,
      cgst,
      sgst,
      totalWithTax,
      totalWithoutTax,

      substr(invoiceDate, 1, 7) as monthKey

    FROM purchases

    WHERE 1=1
  `;


  const purchaseParams = [];


  // ============================================================
  // PURCHASE YEAR
  // ============================================================

  if (year) {

    purchaseQuery += `
      AND substr(invoiceDate, 1, 4) = ?
    `;

    purchaseParams.push(year);

  }


  // ============================================================
  // PURCHASE MONTH
  // ============================================================

  if (month) {

    purchaseQuery += `
      AND substr(invoiceDate, 6, 2) = ?
    `;

    purchaseParams.push(
      String(month).padStart(2, '0')
    );

  }


  // ============================================================
  // PURCHASE DATE RANGE
  // ============================================================

  if (fromDate) {

    purchaseQuery += `
      AND invoiceDate >= ?
    `;

    purchaseParams.push(fromDate);

  }


  if (toDate) {

    purchaseQuery += `
      AND invoiceDate <= ?
    `;

    purchaseParams.push(toDate);

  }


  // ============================================================
  // PURCHASE SUPPLIER
  // ============================================================

  if (supplier) {

    purchaseQuery += `
      AND name = ?
    `;

    purchaseParams.push(supplier);

  }


  // ============================================================
  // PURCHASE PROFORMA
  // ============================================================

  if (shouldExcludeProforma) {

    purchaseQuery += `
      AND UPPER(COALESCE(invoiceNo, '')) NOT LIKE '%PROFARMA%'
      AND UPPER(COALESCE(invoiceNo, '')) NOT LIKE '%PROFORMA%'
    `;

  }


  // ============================================================
  // PURCHASE QUOTATION
  // ============================================================

  if (shouldExcludeQuotation) {

    purchaseQuery += `
      AND UPPER(COALESCE(invoiceNo, '')) NOT LIKE '%QUOTATION%'
      AND UPPER(COALESCE(invoiceNo, '')) NOT LIKE '%QUOTATIONS%'
    `;

  }


  purchaseQuery += `
    ORDER BY invoiceDate DESC
  `;


  const purchases =
    db.prepare(purchaseQuery).all(...purchaseParams);


  // ============================================================
  // MONTHLY SUMMARY
  // ============================================================

  const monthMap = {};


  const addToMonth = (
    key,
    type,
    row
  ) => {

    if (!monthMap[key]) {

      monthMap[key] = {

        month: key,

        sales: {
          count: 0,
          cgst: 0,
          sgst: 0,
          totalWithTax: 0,
          totalWithoutTax: 0
        },

        purchases: {
          count: 0,
          cgst: 0,
          sgst: 0,
          totalWithTax: 0,
          totalWithoutTax: 0
        }

      };

    }


    const m =
      monthMap[key][type];


    m.count++;


    m.cgst =
      +(
        m.cgst +
        Number(row.cgst || 0)
      ).toFixed(2);


    m.sgst =
      +(
        m.sgst +
        Number(row.sgst || 0)
      ).toFixed(2);


    m.totalWithTax =
      +(
        m.totalWithTax +
        Number(row.totalWithTax || 0)
      ).toFixed(2);


    m.totalWithoutTax =
      +(
        m.totalWithoutTax +
        Number(row.totalWithoutTax || 0)
      ).toFixed(2);

  };


  sales.forEach(s =>
    addToMonth(
      s.monthKey,
      'sales',
      s
    )
  );


  purchases.forEach(p =>
    addToMonth(
      p.monthKey,
      'purchases',
      p
    )
  );


  const monthlySummary =
    Object.values(monthMap)
      .sort((a, b) =>
        b.month.localeCompare(a.month)
      );


  // ============================================================
  // SUPPLIER LIST
  //
  // Get supplier names from both bills and purchases.
  // ============================================================

  const billSuppliers =
    db.prepare(`
      SELECT DISTINCT supplierName as supplier
      FROM bills
      WHERE supplierName IS NOT NULL
        AND TRIM(supplierName) != ''
    `)
    .all()
    .map(r => r.supplier);


  const purchaseSuppliers =
    db.prepare(`
      SELECT DISTINCT name as supplier
      FROM purchases
      WHERE name IS NOT NULL
        AND TRIM(name) != ''
    `)
    .all()
    .map(r => r.supplier);


  const suppliers =
    [...new Set([
      ...billSuppliers,
      ...purchaseSuppliers
    ])]
      .sort((a, b) =>
        a.localeCompare(b)
      );


  // ============================================================
  // AVAILABLE YEARS
  // ============================================================

  const yearsFromSales =
    db.prepare(`
      SELECT DISTINCT
        substr(billDate, 1, 4) as y
      FROM bills
      WHERE billDate IS NOT NULL
    `)
    .all()
    .map(r => r.y);


  const yearsFromPurchases =
    db.prepare(`
      SELECT DISTINCT
        substr(invoiceDate, 1, 4) as y
      FROM purchases
      WHERE invoiceDate IS NOT NULL
    `)
    .all()
    .map(r => r.y);


  const availableYears =
    [
      ...new Set([
        ...yearsFromSales,
        ...yearsFromPurchases
      ])
    ]
      .filter(Boolean)
      .sort()
      .reverse();


  // ============================================================
  // RESPONSE
  // ============================================================

  res.json({

    sales,

    purchases,

    monthlySummary,

    availableYears,

    suppliers

  });

});




// Seed some purchases if empty
const pCount = db.prepare('SELECT COUNT(*) as cnt FROM purchases').get().cnt;
if (pCount === 0) {
  const seedPurchases = [
    { invoiceNo: 'PUR-001', invoiceDate: '2025-01-10', name: 'Raw Material Supplier Co', gstNo: '27RAWMT1234A1Z1', taxableAmount: 50000, cgst: 4500, sgst: 4500 },
    { invoiceNo: 'PUR-002', invoiceDate: '2025-02-15', name: 'Office Supplies Ltd', gstNo: '27OFFSP5678B1Z2', taxableAmount: 12000, cgst: 1080, sgst: 1080 },
    { invoiceNo: 'PUR-003', invoiceDate: '2025-03-20', name: 'Transport Services Pvt Ltd', gstNo: '27TRNSP9012C1Z3', taxableAmount: 25000, cgst: 2250, sgst: 2250 },
    { invoiceNo: 'PUR-004', invoiceDate: '2025-04-05', name: 'Raw Material Supplier Co', gstNo: '27RAWMT1234A1Z1', taxableAmount: 75000, cgst: 6750, sgst: 6750 },
    { invoiceNo: 'PUR-005', invoiceDate: '2025-05-12', name: 'Packaging Materials Inc', gstNo: '27PKGMT3456D1Z4', taxableAmount: 18000, cgst: 1620, sgst: 1620 },
  ];
  seedPurchases.forEach(p => {
    db.prepare(`INSERT INTO purchases (invoiceNo, invoiceDate, name, gstNo, taxableAmount, cgst, sgst, totalWithTax, totalWithoutTax)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(p.invoiceNo, p.invoiceDate, p.name, p.gstNo, p.taxableAmount, p.cgst, p.sgst, +(p.taxableAmount + p.cgst + p.sgst).toFixed(2), p.taxableAmount);
  });
  console.log('Seeded 5 purchases.');
}

// ===== Backup Helper =====
function saveBackupToFolder(backupData) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}.json`;
  const filepath = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2));

  // Keep only MAX_BACKUPS files, remove oldest
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time); // newest first

  if (files.length > MAX_BACKUPS) {
    files.slice(MAX_BACKUPS).forEach(f => {
      fs.unlinkSync(path.join(BACKUP_DIR, f.name));
    });
  }
  return { filename, filepath };
}

// ===== Backup & Restore APIs =====

// GET backup - export all bills + purchases as JSON + save to folder
app.get('/api/backup', (req, res) => {
  const rows = db.prepare('SELECT * FROM bills ORDER BY id').all();
  const bills = rows.map(buildBill);
  const purchases = db.prepare('SELECT * FROM purchases ORDER BY id').all();
  const backup = {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    totalBills: bills.length,
    totalPurchases: purchases.length,
    bills,
    purchases,
  };
  const saved = saveBackupToFolder(backup);
  backup.savedAs = saved.filename;
  res.setHeader('Content-Disposition', `attachment; filename=${saved.filename}`);
  res.setHeader('Content-Type', 'application/json');
  res.json(backup);
});

// GET list saved backup files
app.get('/api/backup/files', (req, res) => {
  if (!fs.existsSync(BACKUP_DIR)) return res.json([]);
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      let billCount = 0, purchaseCount = 0;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8'));
        billCount = data.totalBills || data.bills?.length || 0;
        purchaseCount = data.totalPurchases || data.purchases?.length || 0;
      } catch {}
      return { filename: f, size: stat.size, createdAt: stat.mtime.toISOString(), billCount, purchaseCount };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(files);
});

// GET download a specific backup file
app.get('/api/backup/files/:filename', (req, res) => {
  const filepath = path.join(BACKUP_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Disposition', `attachment; filename=${req.params.filename}`);
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(filepath);
});

// DELETE a backup file
app.delete('/api/backup/files/:filename', (req, res) => {
  const filepath = path.join(BACKUP_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
  fs.unlinkSync(filepath);
  res.json({ success: true, deleted: req.params.filename });
});

// POST restore - import bills + purchases from JSON backup
app.post('/api/restore', (req, res) => {
  const { bills: backupBills, purchases: backupPurchases, clearExisting } = req.body;
  if ((!backupBills || !Array.isArray(backupBills)) && (!backupPurchases || !Array.isArray(backupPurchases))) {
    return res.status(400).json({ error: 'Invalid backup format. Expected { bills: [...], purchases: [...] }' });
  }
  try {
    const safetyBackup = createAutoBackup('pre-restore');
    if (safetyBackup) console.log('Pre-restore backup saved:', safetyBackup.filename);

    const restoreTx = db.transaction(() => {
      if (clearExisting) {
        db.prepare('DELETE FROM bill_items').run();
        db.prepare('DELETE FROM bills').run();
        db.prepare('DELETE FROM purchases').run();
      }
      if (backupBills) backupBills.forEach(b => saveBillToDB(b));
      if (backupPurchases) {
        backupPurchases.forEach(p => {
          const taxable = +(p.taxableAmount || 0);
          const cgst = +(p.cgst || 0);
          const sgst = +(p.sgst || 0);
          db.prepare(`INSERT INTO purchases (invoiceNo, invoiceDate, name, gstNo, taxableAmount, cgst, sgst, totalWithTax, totalWithoutTax)
            VALUES (?,?,?,?,?,?,?,?,?)`).run(
            p.invoiceNo, p.invoiceDate, p.name, p.gstNo, taxable, cgst, sgst,
            +(taxable + cgst + sgst).toFixed(2), taxable
          );
        });
      }
    });
    restoreTx();
    const totalBills = db.prepare('SELECT COUNT(*) as cnt FROM bills').get().cnt;
    const totalPurchases = db.prepare('SELECT COUNT(*) as cnt FROM purchases').get().cnt;
    res.json({
      success: true,
      importedBills: backupBills?.length || 0,
      importedPurchases: backupPurchases?.length || 0,
      totalBillsNow: totalBills,
      totalPurchasesNow: totalPurchases,
    });
  } catch (err) {
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} (SQLite: ${dbPath})`);

  // Daily auto backup at midnight
  function scheduleDailyBackup() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    setTimeout(() => {
      const result = createAutoBackup('daily-scheduled');
      if (result) console.log(`[${new Date().toISOString()}] Daily backup saved: ${result.filename}`);
      // Schedule next one
      setInterval(() => {
        const r = createAutoBackup('daily-scheduled');
        if (r) console.log(`[${new Date().toISOString()}] Daily backup saved: ${r.filename}`);
      }, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);

    console.log(`Daily backup scheduled. Next run in ${Math.round(msUntilMidnight / 60000)} minutes.`);
  }
  scheduleDailyBackup();
});
