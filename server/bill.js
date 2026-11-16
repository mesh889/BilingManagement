const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

module.exports = function registerBilling(app, db) {
  if (!app || !db) throw new Error('app and db are required');

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

      buyerName TEXT,
      buyerGstNo TEXT,

      supplierName TEXT,
      supplierGstNo TEXT,

      taxableAmount REAL DEFAULT 0,

      cgstPercent REAL DEFAULT 0,
      cgstAmount REAL DEFAULT 0,

      sgstPercent REAL DEFAULT 0,
      sgstAmount REAL DEFAULT 0,

      grandTotal REAL DEFAULT 0,

      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
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

// ===== Purchase CRUD APIs =====

// Calculate purchase totals
function calculatePurchaseTotals(p) {
  const taxableAmount = +(p.taxableAmount || 0);

  const cgstPercent = +(p.cgstPercent || 0);
  const sgstPercent = +(p.sgstPercent || 0);

  const cgstAmount = +(
    taxableAmount * cgstPercent / 100
  ).toFixed(2);

  const sgstAmount = +(
    taxableAmount * sgstPercent / 100
  ).toFixed(2);

  const grandTotal = +(
    taxableAmount + cgstAmount + sgstAmount
  ).toFixed(2);

  return {
    taxableAmount,
    cgstPercent,
    cgstAmount,
    sgstPercent,
    sgstAmount,
    grandTotal
  };
}


// GET all purchases
app.get('/api/purchases', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT *
      FROM purchases
      ORDER BY invoiceDate DESC, id DESC
    `).all();

    res.json(rows);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch purchases',
      message: err.message
    });
  }
});


// GET purchase by ID
app.get('/api/purchases/:id', (req, res) => {
  try {
    const row = db.prepare(`
      SELECT *
      FROM purchases
      WHERE id = ?
    `).get(req.params.id);

    if (!row) {
      return res.status(404).json({
        error: 'Purchase not found'
      });
    }

    res.json(row);

  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch purchase',
      message: err.message
    });
  }
});


// CREATE purchase
app.post('/api/purchases', (req, res) => {
  try {
    const p = req.body;

    if (!p.invoiceNo || !p.invoiceDate) {
      return res.status(400).json({
        error: 'Invoice number and invoice date are required'
      });
    }

    const totals = calculatePurchaseTotals(p);

    const result = db.prepare(`
      INSERT INTO purchases (
        invoiceNo,
        invoiceDate,

        buyerName,
        buyerGstNo,

        supplierName,
        supplierGstNo,

        taxableAmount,

        cgstPercent,
        cgstAmount,

        sgstPercent,
        sgstAmount,

        grandTotal
      )
      VALUES (
        ?, ?,
        ?, ?,
        ?, ?,
        ?,
        ?, ?,
        ?, ?,
        ?
      )
    `).run(
      p.invoiceNo,
      p.invoiceDate,

      p.buyerName || '',
      p.buyerGstNo || '',

      p.supplierName || '',
      p.supplierGstNo || '',

      totals.taxableAmount,

      totals.cgstPercent,
      totals.cgstAmount,

      totals.sgstPercent,
      totals.sgstAmount,

      totals.grandTotal
    );

    const purchase = db.prepare(`
      SELECT *
      FROM purchases
      WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(purchase);

  } catch (err) {
    res.status(500).json({
      error: 'Failed to create purchase',
      message: err.message
    });
  }
});


// UPDATE purchase
app.put('/api/purchases/:id', (req, res) => {
  try {
    const existing = db.prepare(`
      SELECT *
      FROM purchases
      WHERE id = ?
    `).get(req.params.id);

    if (!existing) {
      return res.status(404).json({
        error: 'Purchase not found'
      });
    }

    const p = req.body;

    if (!p.invoiceNo || !p.invoiceDate) {
      return res.status(400).json({
        error: 'Invoice number and invoice date are required'
      });
    }

    const totals = calculatePurchaseTotals(p);

    db.prepare(`
      UPDATE purchases
      SET
        invoiceNo = ?,
        invoiceDate = ?,

        buyerName = ?,
        buyerGstNo = ?,

        supplierName = ?,
        supplierGstNo = ?,

        taxableAmount = ?,

        cgstPercent = ?,
        cgstAmount = ?,

        sgstPercent = ?,
        sgstAmount = ?,

        grandTotal = ?,

        updatedAt = datetime('now')

      WHERE id = ?
    `).run(
      p.invoiceNo,
      p.invoiceDate,

      p.buyerName || '',
      p.buyerGstNo || '',

      p.supplierName || '',
      p.supplierGstNo || '',

      totals.taxableAmount,

      totals.cgstPercent,
      totals.cgstAmount,

      totals.sgstPercent,
      totals.sgstAmount,

      totals.grandTotal,

      req.params.id
    );

    const purchase = db.prepare(`
      SELECT *
      FROM purchases
      WHERE id = ?
    `).get(req.params.id);

    res.json(purchase);

  } catch (err) {
    res.status(500).json({
      error: 'Failed to update purchase',
      message: err.message
    });
  }
});


// DELETE purchase
app.delete('/api/purchases/:id', (req, res) => {
  try {
    const existing = db.prepare(`
      SELECT *
      FROM purchases
      WHERE id = ?
    `).get(req.params.id);

    if (!existing) {
      return res.status(404).json({
        error: 'Purchase not found'
      });
    }

    db.prepare(`
      DELETE FROM purchases
      WHERE id = ?
    `).run(req.params.id);

    res.json({
      success: true,
      message: 'Purchase deleted successfully'
    });

  } catch (err) {
    res.status(500).json({
      error: 'Failed to delete purchase',
      message: err.message
    });
  }
});


// ===== Report API =====
// ===== Report API =====
app.get('/api/report', (req, res) => {
  const { year, month } = req.query;
  const supplier = String(req.query.supplier ?? '').trim();

  // Support both new and old query parameter names
  const excludeInvoices =
    String(req.query.excludeInvoices ?? req.query.exclude ?? 'false')
      .toLowerCase() === 'true';

  const excludeKeywords = String(
    req.query.excludeKeywords ?? req.query.keyword ?? ''
  );

  const keywords = excludeKeywords
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(Boolean);

  // ==========================================
  // SALES QUERY - Includes total quantity
  // ==========================================
  let salesQuery = `
    SELECT
      b.id,
      b.billNumber AS invoiceNo,
      b.billDate AS invoiceDate,

      -- Buyer details
      b.buyerName,
      b.buyerGstNo,
      b.buyerPan,
      b.buyerAddress,
      b.buyerPhone,

      -- Supplier details
      b.supplierName,
      b.supplierGstNo,
      b.supplierPan,
      b.supplierAddress,
      b.supplierPhone,

      -- Bank details
      b.bankName,
      b.accountNumber,
      b.ifscCode,

      -- Amount details
      b.totalAmount AS taxableAmount,
      b.totalGst,
      b.grandTotal,
      b.grandTotal AS totalWithTax,
      b.totalAmount AS totalWithoutTax,

      -- Total quantity of all items in each bill
      COALESCE((
        SELECT SUM(COALESCE(bi.quantity, 0))
        FROM bill_items bi
        WHERE bi.billId = b.id
      ), 0) AS totalQuantity,

      substr(b.billDate, 1, 7) AS monthKey

    FROM bills b
    WHERE 1=1
  `;

  const salesParams = [];

  // Filter by year
  if (year) {
    salesQuery += ` AND substr(b.billDate, 1, 4) = ?`;
    salesParams.push(year);
  }

  // Filter by month
  if (month) {
    salesQuery += ` AND substr(b.billDate, 6, 2) = ?`;
    salesParams.push(String(month).padStart(2, '0'));
  }

  // Exclude invoices containing any specified keyword
  if (excludeInvoices && keywords.length > 0) {
    const conditions = keywords.map(() => `
      instr(
        lower(trim(COALESCE(b.billNumber, ''))),
        ?
      ) = 0
    `);

    salesQuery += ` AND ${conditions.join(' AND ')}`;
    salesParams.push(...keywords);
  }

  // Filter sales by supplier name
  if (supplier) {
    salesQuery += `
      AND LOWER(TRIM(COALESCE(b.supplierName, ''))) =
          LOWER(TRIM(?))
    `;
    salesParams.push(supplier);
  }

  salesQuery += ` ORDER BY b.billDate DESC`;

  const sales = db.prepare(salesQuery).all(...salesParams);

  // Calculate CGST and SGST for sales
  sales.forEach(s => {
    const gst = Number(s.totalGst || 0);

    s.cgst = +(gst / 2).toFixed(2);
    s.sgst = +(gst / 2).toFixed(2);

    // Ensure total quantity is numeric
    s.totalQuantity = Number(s.totalQuantity || 0);
  });

  // ==========================================
  // PURCHASES QUERY - Unchanged
  // ==========================================
  let purchaseQuery = `
    SELECT
      invoiceNo,
      invoiceDate,
      buyerName,
      buyerGstNo,
      supplierName,
      supplierGstNo,
      taxableAmount,
      cgstPercent,
      cgstAmount,
      sgstPercent,
      sgstAmount,
      grandTotal,
      taxableAmount AS totalWithoutTax,
      grandTotal AS totalWithTax,
      substr(invoiceDate, 1, 7) AS monthKey
    FROM purchases
    WHERE 1=1
  `;

  const purchaseParams = [];

  // Filter purchases by year
  if (year) {
    purchaseQuery += ` AND substr(invoiceDate, 1, 4) = ?`;
    purchaseParams.push(year);
  }

  // Filter purchases by month
  if (month) {
    purchaseQuery += ` AND substr(invoiceDate, 6, 2) = ?`;
    purchaseParams.push(String(month).padStart(2, '0'));
  }

  // Apply invoice keyword exclusion to purchases
  if (excludeInvoices && keywords.length > 0) {
    const conditions = keywords.map(() => `
      instr(
        lower(trim(COALESCE(invoiceNo, ''))),
        ?
      ) = 0
    `);

    purchaseQuery += ` AND ${conditions.join(' AND ')}`;
    purchaseParams.push(...keywords);
  }

  purchaseQuery += ` ORDER BY invoiceDate DESC`;

  const purchases = db
    .prepare(purchaseQuery)
    .all(...purchaseParams);

  // Calculate CGST and SGST for purchases
  purchases.forEach(p => {
    p.cgst = Number(p.cgstAmount || 0);
    p.sgst = Number(p.sgstAmount || 0);
  });

  // ==========================================
  // MONTHLY SUMMARY - Includes sales quantity
  // ==========================================
  const monthMap = {};

  const addToMonth = (key, type, row) => {
    if (!monthMap[key]) {
      monthMap[key] = {
        month: key,

        sales: {
          count: 0,
          totalQuantity: 0,
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

    const m = monthMap[key][type];

    // Invoice count
    m.count++;

    // Total sales quantity
    if (type === 'sales') {
      m.totalQuantity = +(
        m.totalQuantity + Number(row.totalQuantity || 0)
      ).toFixed(2);
    }

    // GST totals
    m.cgst = +(
      m.cgst + Number(row.cgst || 0)
    ).toFixed(2);

    m.sgst = +(
      m.sgst + Number(row.sgst || 0)
    ).toFixed(2);

    // Amount totals
    m.totalWithTax = +(
      m.totalWithTax + Number(row.totalWithTax || 0)
    ).toFixed(2);

    m.totalWithoutTax = +(
      m.totalWithoutTax + Number(row.totalWithoutTax || 0)
    ).toFixed(2);
  };

  // Build monthly summaries after applying filters
  sales.forEach(s => {
    addToMonth(s.monthKey, 'sales', s);
  });

  purchases.forEach(p => {
    addToMonth(p.monthKey, 'purchases', p);
  });

  const monthlySummary = Object.values(monthMap)
    .sort((a, b) => b.month.localeCompare(a.month));

  // ==========================================
  // AVAILABLE YEARS
  // ==========================================
  const yearsFromSales = db.prepare(`
    SELECT DISTINCT substr(billDate, 1, 4) AS y
    FROM bills
  `).all().map(r => r.y);

  const yearsFromPurchases = db.prepare(`
    SELECT DISTINCT substr(invoiceDate, 1, 4) AS y
    FROM purchases
  `).all().map(r => r.y);

  const availableYears = [
    ...new Set([
      ...yearsFromSales,
      ...yearsFromPurchases
    ])
  ].sort().reverse();

  // ==========================================
  // FINAL RESPONSE
  // ==========================================
  res.json({
    sales,
    purchases,
    monthlySummary,
    availableYears
  });
});

  return { apiBasePath: '/api' };
};
