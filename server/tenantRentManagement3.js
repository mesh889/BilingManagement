/**
 * tenantRentManagement.js
 *
 * Modular Tenant / Rent / Property Management API module.
 *
 * Usage from index.js:
 *
 *   const tenantRentManagement = require("./tenantRentManagement");
 *   tenantRentManagement(app, db);
 *
 * Expected:
 *   - app  = Express application
 *   - db   = sqlite3 Database instance
 *
 * The module:
 *   - Creates required tables if they do not exist
 *   - Creates indexes
 *   - Provides CRUD APIs for properties and tenants
 *   - Provides collection/expense transaction APIs
 *   - Auto-generates transaction IDs
 *   - Provides master/dropdown APIs
 *   - Provides dashboard APIs
 *   - Soft-deletes properties/tenants
 *   - Voids financial transactions instead of physically deleting them
 */

module.exports = function registerTenantRentManagement(app, db, options = {}) {
    const API_BASE = options.apiBase || "/api";

    if (!app) {
        throw new Error("tenantRentManagement: Express app is required.");
    }

    if (!db) {
        throw new Error("tenantRentManagement: SQLite database instance is required.");
    }

    // ---------------------------------------------------------------------------
    // SQLite helpers
    // ---------------------------------------------------------------------------

    function run(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function (err) {
                if (err) {
                    reject(err);
                    return;
                }

                resolve({
                    lastID: this.lastID,
                    changes: this.changes,
                });
            });
        });
    }

    function get(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }

                resolve(row);
            });
        });
    }

    function all(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                resolve(rows || []);
            });
        });
    }

    function exec(sql) {
        return new Promise((resolve, reject) => {
            db.exec(sql, (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                resolve();
            });
        });
    }

    // ---------------------------------------------------------------------------
    // General helpers
    // ---------------------------------------------------------------------------

    function sendError(res, error, status = 500) {
        console.error("TenantRentManagement API Error:", error);

        return res.status(status).json({
            success: false,
            message: error && error.message
                ? error.message
                : "Something went wrong.",
        });
    }

    function isValidId(value) {
        return Number.isInteger(Number(value)) && Number(value) > 0;
    }

    function toNumber(value, defaultValue = 0) {
        if (value === null || value === undefined || value === "") {
            return defaultValue;
        }

        const n = Number(value);

        return Number.isFinite(n) ? n : defaultValue;
    }

    function cleanString(value) {
        if (value === null || value === undefined) {
            return null;
        }

        const str = String(value).trim();

        return str === "" ? null : str;
    }

    function normalizeDate(value) {
        if (!value) {
            return null;
        }

        const str = String(value).trim();

        // YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
            return str;
        }

        return str;
    }

    function generatePropertyCode() {
        return `PROP-${Date.now()}-${Math.floor(
            1000 + Math.random() * 9000
        )}`;
    }

    function generateTransactionId() {
        const now = new Date();

        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        const hh = String(now.getHours()).padStart(2, "0");
        const mi = String(now.getMinutes()).padStart(2, "0");
        const ss = String(now.getSeconds()).padStart(2, "0");

        const random = Math.floor(1000 + Math.random() * 9000);

        return `TXN-${yyyy}${mm}${dd}${hh}${mi}${ss}-${random}`;
    }

    async function generateUniqueTransactionId() {
        let transactionId;

        for (let i = 0; i < 10; i++) {
            transactionId = generateTransactionId();

            const existing = await get(
                `SELECT id
         FROM entries
         WHERE transaction_id = ?
         LIMIT 1`,
                [transactionId]
            );

            if (!existing) {
                return transactionId;
            }
        }

        throw new Error("Unable to generate unique transaction ID.");
    }

    function getCurrentDate() {
        const d = new Date();

        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");

        return `${yyyy}-${mm}-${dd}`;
    }

    function getCurrentMonth() {
        return getCurrentDate().substring(0, 7);
    }

    function getCurrentYear() {
        return Number(getCurrentDate().substring(0, 4));
    }

    function validateMonth(month) {
        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return false;
        }

        const parts = month.split("-");

        const year = Number(parts[0]);
        const monthNumber = Number(parts[1]);

        return (
            year >= 2000 &&
            year <= 2100 &&
            monthNumber >= 1 &&
            monthNumber <= 12
        );
    }

    function validateYear(year) {
        const value = Number(year);

        return (
            Number.isInteger(value) &&
            value >= 2000 &&
            value <= 2100
        );
    }

    // ---------------------------------------------------------------------------
    // Master values
    // ---------------------------------------------------------------------------

    const MASTER_VALUES = {
        TYPES: [
            "COLLECTION",
            "EXPENSE",
        ],

        COLLECTION_CATEGORIES: [
            "RENT_COLLECTION",
        ],

        EXPENSE_CATEGORIES: [
            "MAINTENANCE",
            "DEPOSIT_RETURN",
            "PAINTING",
            "OTHER_EXPENSE",
        ],

        PAYMENT_MODES: [
            "CASH",
            "BANK",
            "UPI",
            "OTHER",
        ],
    };

    // ---------------------------------------------------------------------------
    // Database initialization
    // ---------------------------------------------------------------------------

    async function initializeDatabase() {
        await exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        property_code TEXT NOT NULL UNIQUE,

        property_name TEXT NOT NULL,

        location TEXT,

        property_details TEXT,

        status TEXT NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE', 'INACTIVE')),

        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        tenant_name TEXT NOT NULL,

        tenant_phone TEXT,

        tenant_email TEXT,

        property_id INTEGER NOT NULL,

        deposit_amount REAL NOT NULL DEFAULT 0,

        agreement_start_date TEXT,

        agreement_end_date TEXT,

        rent_amount REAL NOT NULL DEFAULT 0,

        status TEXT NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE', 'ENDED', 'INACTIVE')),

        notes TEXT,

        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (property_id)
          REFERENCES properties(id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        transaction_id TEXT NOT NULL UNIQUE,

        entry_date TEXT NOT NULL,

        entry_type TEXT NOT NULL
          CHECK (entry_type IN ('COLLECTION', 'EXPENSE')),

        property_id INTEGER NOT NULL,

        tenant_id INTEGER,

        category TEXT NOT NULL,

        amount REAL NOT NULL CHECK (amount >= 0),

        payment_mode TEXT,

        reference_no TEXT,

        notes TEXT,

        status TEXT NOT NULL DEFAULT 'POSTED'
          CHECK (status IN ('POSTED', 'VOID')),

        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (property_id)
          REFERENCES properties(id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,

        FOREIGN KEY (tenant_id)
          REFERENCES tenants(id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_properties_status
        ON properties(status);

      CREATE INDEX IF NOT EXISTS idx_tenants_property
        ON tenants(property_id);

      CREATE INDEX IF NOT EXISTS idx_tenants_status
        ON tenants(status);

      CREATE INDEX IF NOT EXISTS idx_entries_date
        ON entries(entry_date);

      CREATE INDEX IF NOT EXISTS idx_entries_type
        ON entries(entry_type);

      CREATE INDEX IF NOT EXISTS idx_entries_property
        ON entries(property_id);

      CREATE INDEX IF NOT EXISTS idx_entries_tenant
        ON entries(tenant_id);

      CREATE INDEX IF NOT EXISTS idx_entries_status
        ON entries(status);
    `);

        console.log("Tenant/Rent Management database tables initialized.");
    }

    // ---------------------------------------------------------------------------
    // Health
    // ---------------------------------------------------------------------------

    app.get(`${API_BASE}/tenant-rent/health`, async (req, res) => {
        try {
            res.json({
                success: true,
                module: "tenantRentManagement",
                database: "connected",
                date: getCurrentDate(),
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // ---------------------------------------------------------------------------
    // PROPERTIES
    // ---------------------------------------------------------------------------

    // GET all properties
    app.get(`${API_BASE}/properties`, async (req, res) => {
        try {
            const includeInactive =
                String(req.query.include_inactive || "").toLowerCase() === "true";

            let sql = `
        SELECT
          p.id,
          p.property_code,
          p.property_name,
          p.location,
          p.property_details,
          p.status,
          p.created_at,
          p.updated_at,

          (
            SELECT COUNT(*)
            FROM tenants t
            WHERE t.property_id = p.id
              AND t.status = 'ACTIVE'
          ) AS active_tenant_count

        FROM properties p
      `;

            const params = [];

            if (!includeInactive) {
                sql += ` WHERE p.status = 'ACTIVE' `;
            }

            sql += ` ORDER BY p.property_name COLLATE NOCASE ASC `;

            const rows = await all(sql, params);

            res.json({
                success: true,
                data: rows,
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // GET property by ID
    app.get(`${API_BASE}/properties/:id`, async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid property ID.",
                });
            }

            const property = await get(
                `
        SELECT
          p.*,

          (
            SELECT COUNT(*)
            FROM tenants t
            WHERE t.property_id = p.id
              AND t.status = 'ACTIVE'
          ) AS active_tenant_count

        FROM properties p
        WHERE p.id = ?
        `,
                [Number(id)]
            );

            if (!property) {
                return res.status(404).json({
                    success: false,
                    message: "Property not found.",
                });
            }

            res.json({
                success: true,
                data: property,
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // ADD property
    app.post(`${API_BASE}/properties`, async (req, res) => {
        try {
            const {
                property_code,
                property_name,
                location,
                property_details,
                status,
            } = req.body || {};

            const name = cleanString(property_name);

            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: "Property name is required.",
                });
            }

            let propertyCode = cleanString(property_code);

            if (!propertyCode) {
                propertyCode = generatePropertyCode();
            }

            const propertyStatus =
                status === "INACTIVE" ? "INACTIVE" : "ACTIVE";

            const result = await run(
                `
        INSERT INTO properties (
          property_code,
          property_name,
          location,
          property_details,
          status
        )
        VALUES (?, ?, ?, ?, ?)
        `,
                [
                    propertyCode,
                    name,
                    cleanString(location),
                    cleanString(property_details),
                    propertyStatus,
                ]
            );

            const property = await get(
                `
        SELECT *
        FROM properties
        WHERE id = ?
        `,
                [result.lastID]
            );

            res.status(201).json({
                success: true,
                message: "Property created successfully.",
                data: property,
            });
        } catch (error) {
            if (error && error.message && error.message.includes("UNIQUE")) {
                return sendError(
                    res,
                    new Error("Property code already exists."),
                    409
                );
            }

            sendError(res, error);
        }
    });

    // UPDATE property
    app.put(`${API_BASE}/properties/:id`, async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid property ID.",
                });
            }

            const existing = await get(
                `
        SELECT *
        FROM properties
        WHERE id = ?
        `,
                [Number(id)]
            );

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: "Property not found.",
                });
            }

            const {
                property_code,
                property_name,
                location,
                property_details,
                status,
            } = req.body || {};

            const name =
                cleanString(property_name) || existing.property_name;

            const propertyCode =
                cleanString(property_code) || existing.property_code;

            let propertyStatus = existing.status;

            if (status === "ACTIVE" || status === "INACTIVE") {
                propertyStatus = status;
            }

            await run(
                `
        UPDATE properties
        SET
          property_code = ?,
          property_name = ?,
          location = ?,
          property_details = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
                [
                    propertyCode,
                    name,
                    cleanString(location),
                    cleanString(property_details),
                    propertyStatus,
                    Number(id),
                ]
            );

            const property = await get(
                `
        SELECT *
        FROM properties
        WHERE id = ?
        `,
                [Number(id)]
            );

            res.json({
                success: true,
                message: "Property updated successfully.",
                data: property,
            });
        } catch (error) {
            if (error && error.message && error.message.includes("UNIQUE")) {
                return sendError(
                    res,
                    new Error("Property code already exists."),
                    409
                );
            }

            sendError(res, error);
        }
    });

    // DELETE property = SOFT DELETE
    app.delete(`${API_BASE}/properties/:id`, async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid property ID.",
                });
            }

            const property = await get(
                `
        SELECT id
        FROM properties
        WHERE id = ?
        `,
                [Number(id)]
            );

            if (!property) {
                return res.status(404).json({
                    success: false,
                    message: "Property not found.",
                });
            }

            await run(
                `
        UPDATE properties
        SET
          status = 'INACTIVE',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
                [Number(id)]
            );

            res.json({
                success: true,
                message: "Property deactivated successfully.",
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // ---------------------------------------------------------------------------
    // TENANTS
    // ---------------------------------------------------------------------------

    // GET tenants
    app.get(`${API_BASE}/tenants`, async (req, res) => {
        try {
            const includeInactive =
                String(req.query.include_inactive || "").toLowerCase() === "true";

            let sql = `
      SELECT
        t.id,
        t.tenant_name,
        t.tenant_phone,
        t.tenant_email,
        t.property_id,
        p.property_code,
        p.property_name,
        p.location,
        t.deposit_amount,
        t.agreement_start_date,
        t.agreement_end_date,
        t.rent_amount,
        t.status,
        t.notes,
        t.created_at,
        t.updated_at

      FROM tenants t

      INNER JOIN properties p
        ON p.id = t.property_id

      WHERE 1 = 1
    `;

            const params = [];

            if (!includeInactive) {
                sql += ` AND t.status = 'ACTIVE' `;
            }

            if (req.query.property_id) {
                sql += ` AND t.property_id = ? `;
                params.push(Number(req.query.property_id));
            }

            sql += `
      ORDER BY t.tenant_name COLLATE NOCASE ASC
    `;

            const rows = await all(sql, params);

            res.json({
                success: true,
                data: rows,
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // GET tenant by ID
    app.get(`${API_BASE}/tenants/:id`, async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid tenant ID.",
                });
            }

            const tenant = await get(
                `
        SELECT
          t.*,
          p.property_code,
          p.property_name,
          p.location

        FROM tenants t

        INNER JOIN properties p
          ON p.id = t.property_id

        WHERE t.id = ?
        `,
                [Number(id)]
            );

            if (!tenant) {
                return res.status(404).json({
                    success: false,
                    message: "Tenant not found.",
                });
            }

            res.json({
                success: true,
                data: tenant,
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // ADD tenant
    app.post(`${API_BASE}/tenants`, async (req, res) => {
        try {
            const {
                tenant_name,
                tenant_phone,
                tenant_email,
                property_id,
                deposit_amount,
                agreement_start_date,
                agreement_end_date,
                rent_amount,
                status,
                notes,
            } = req.body || {};

            const name = cleanString(tenant_name);

            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: "Tenant name is required.",
                });
            }

            if (!isValidId(property_id)) {
                return res.status(400).json({
                    success: false,
                    message: "Valid property is required.",
                });
            }

            const property = await get(
                `
        SELECT id
        FROM properties
        WHERE id = ?
          AND status = 'ACTIVE'
        `,
                [Number(property_id)]
            );

            if (!property) {
                return res.status(400).json({
                    success: false,
                    message: "Selected property does not exist or is inactive.",
                });
            }

            const tenantStatus =
                status === "ENDED" || status === "INACTIVE"
                    ? status
                    : "ACTIVE";

            const result = await run(
                `
        INSERT INTO tenants (
          tenant_name,
          tenant_phone,
          tenant_email,
          property_id,
          deposit_amount,
          agreement_start_date,
          agreement_end_date,
          rent_amount,
          status,
          notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
                [
                    name,
                    cleanString(tenant_phone),
                    cleanString(tenant_email),
                    Number(property_id),
                    toNumber(deposit_amount),
                    normalizeDate(agreement_start_date),
                    normalizeDate(agreement_end_date),
                    toNumber(rent_amount),
                    tenantStatus,
                    cleanString(notes),
                ]
            );

            const tenant = await get(
                `
        SELECT
          t.*,
          p.property_code,
          p.property_name,
          p.location

        FROM tenants t

        INNER JOIN properties p
          ON p.id = t.property_id

        WHERE t.id = ?
        `,
                [result.lastID]
            );

            res.status(201).json({
                success: true,
                message: "Tenant created successfully.",
                data: tenant,
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // UPDATE tenant
    app.put(`${API_BASE}/tenants/:id`, async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid tenant ID.",
                });
            }

            const existing = await get(
                `
        SELECT *
        FROM tenants
        WHERE id = ?
        `,
                [Number(id)]
            );

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: "Tenant not found.",
                });
            }

            const {
                tenant_name,
                tenant_phone,
                tenant_email,
                property_id,
                deposit_amount,
                agreement_start_date,
                agreement_end_date,
                rent_amount,
                status,
                notes,
            } = req.body || {};

            const name =
                cleanString(tenant_name) || existing.tenant_name;

            const selectedPropertyId =
                isValidId(property_id)
                    ? Number(property_id)
                    : existing.property_id;

            const property = await get(
                `
        SELECT id
        FROM properties
        WHERE id = ?
        `,
                [selectedPropertyId]
            );

            if (!property) {
                return res.status(400).json({
                    success: false,
                    message: "Selected property does not exist.",
                });
            }

            let tenantStatus = existing.status;

            if (
                status === "ACTIVE" ||
                status === "ENDED" ||
                status === "INACTIVE"
            ) {
                tenantStatus = status;
            }

            await run(
                `
        UPDATE tenants
        SET
          tenant_name = ?,
          tenant_phone = ?,
          tenant_email = ?,
          property_id = ?,
          deposit_amount = ?,
          agreement_start_date = ?,
          agreement_end_date = ?,
          rent_amount = ?,
          status = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
                [
                    name,
                    cleanString(tenant_phone),
                    cleanString(tenant_email),
                    selectedPropertyId,
                    toNumber(deposit_amount, existing.deposit_amount),
                    normalizeDate(agreement_start_date) ||
                    existing.agreement_start_date,
                    normalizeDate(agreement_end_date) ||
                    existing.agreement_end_date,
                    toNumber(rent_amount, existing.rent_amount),
                    tenantStatus,
                    cleanString(notes),
                    Number(id),
                ]
            );

            const tenant = await get(
                `
        SELECT
          t.*,
          p.property_code,
          p.property_name,
          p.location

        FROM tenants t

        INNER JOIN properties p
          ON p.id = t.property_id

        WHERE t.id = ?
        `,
                [Number(id)]
            );

            res.json({
                success: true,
                message: "Tenant updated successfully.",
                data: tenant,
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // DELETE tenant = SOFT DELETE
    app.delete(`${API_BASE}/tenants/:id`, async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid tenant ID.",
                });
            }

            const tenant = await get(
                `
        SELECT id
        FROM tenants
        WHERE id = ?
        `,
                [Number(id)]
            );

            if (!tenant) {
                return res.status(404).json({
                    success: false,
                    message: "Tenant not found.",
                });
            }

            await run(
                `
        UPDATE tenants
        SET
          status = 'INACTIVE',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
                [Number(id)]
            );

            res.json({
                success: true,
                message: "Tenant deactivated successfully.",
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // ---------------------------------------------------------------------------
    // ENTRIES / TRANSACTIONS
    // ---------------------------------------------------------------------------

    // GET entries
    app.get(`${API_BASE}/entries`, async (req, res) => {
        try {
            let sql = `
        SELECT
          e.id,
          e.transaction_id,
          e.entry_date,
          e.entry_type,
          e.property_id,
          p.property_code,
          p.property_name,

          e.tenant_id,
          t.tenant_name,

          e.category,
          e.amount,
          e.payment_mode,
          e.reference_no,
          e.notes,
          e.status,
          e.created_at,
          e.updated_at

        FROM entries e

        INNER JOIN properties p
          ON p.id = e.property_id

        LEFT JOIN tenants t
          ON t.id = e.tenant_id

        WHERE 1 = 1
      `;

            const params = [];

            if (req.query.status) {
                sql += ` AND e.status = ? `;
                params.push(String(req.query.status));
            }

            if (req.query.entry_type) {
                sql += ` AND e.entry_type = ? `;
                params.push(String(req.query.entry_type));
            }

            if (req.query.property_id) {
                sql += ` AND e.property_id = ? `;
                params.push(Number(req.query.property_id));
            }

            if (req.query.tenant_id) {
                sql += ` AND e.tenant_id = ? `;
                params.push(Number(req.query.tenant_id));
            }

            if (req.query.from_date) {
                sql += ` AND e.entry_date >= ? `;
                params.push(String(req.query.from_date));
            }

            if (req.query.to_date) {
                sql += ` AND e.entry_date <= ? `;
                params.push(String(req.query.to_date));
            }

            sql += `
        ORDER BY
          e.entry_date DESC,
          e.id DESC
      `;

            const rows = await all(sql, params);

            res.json({
                success: true,
                data: rows,
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // GET entry by ID
    app.get(`${API_BASE}/entries/:id`, async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid entry ID.",
                });
            }

            const entry = await get(
                `
        SELECT
          e.*,

          p.property_code,
          p.property_name,

          t.tenant_name

        FROM entries e

        INNER JOIN properties p
          ON p.id = e.property_id

        LEFT JOIN tenants t
          ON t.id = e.tenant_id

        WHERE e.id = ?
        `,
                [Number(id)]
            );

            if (!entry) {
                return res.status(404).json({
                    success: false,
                    message: "Entry not found.",
                });
            }

            res.json({
                success: true,
                data: entry,
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // ADD entry
    app.post(`${API_BASE}/entries`, async (req, res) => {
        try {
            const {
                entry_date,
                entry_type,
                property_id,
                tenant_id,
                category,
                amount,
                payment_mode,
                reference_no,
                notes,
            } = req.body || {};

            const entryType = cleanString(entry_type);

            if (
                entryType !== "COLLECTION" &&
                entryType !== "EXPENSE"
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Entry type must be COLLECTION or EXPENSE.",
                });
            }

            if (!isValidId(property_id)) {
                return res.status(400).json({
                    success: false,
                    message: "Valid property is required.",
                });
            }

            const property = await get(
                `
        SELECT id
        FROM properties
        WHERE id = ?
          AND status = 'ACTIVE'
        `,
                [Number(property_id)]
            );

            if (!property) {
                return res.status(400).json({
                    success: false,
                    message: "Selected property does not exist or is inactive.",
                });
            }

            let tenantId = null;

            if (tenant_id !== null && tenant_id !== undefined && tenant_id !== "") {
                if (!isValidId(tenant_id)) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid tenant ID.",
                    });
                }

                const tenant = await get(
                    `
          SELECT id
          FROM tenants
          WHERE id = ?
        `,
                    [Number(tenant_id)]
                );

                if (!tenant) {
                    return res.status(400).json({
                        success: false,
                        message: "Selected tenant does not exist.",
                    });
                }

                tenantId = Number(tenant_id);
            }

            const transactionCategory = cleanString(category);

            if (!transactionCategory) {
                return res.status(400).json({
                    success: false,
                    message: "Category is required.",
                });
            }

            const transactionAmount = toNumber(amount);

            if (transactionAmount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Amount must be greater than zero.",
                });
            }

            const transactionId = await generateUniqueTransactionId();

            const result = await run(
                `
        INSERT INTO entries (
          transaction_id,
          entry_date,
          entry_type,
          property_id,
          tenant_id,
          category,
          amount,
          payment_mode,
          reference_no,
          notes,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED')
        `,
                [
                    transactionId,
                    normalizeDate(entry_date) || getCurrentDate(),
                    entryType,
                    Number(property_id),
                    tenantId,
                    transactionCategory,
                    transactionAmount,
                    cleanString(payment_mode),
                    cleanString(reference_no),
                    cleanString(notes),
                ]
            );

            const entry = await get(
                `
        SELECT
          e.*,

          p.property_code,
          p.property_name,

          t.tenant_name

        FROM entries e

        INNER JOIN properties p
          ON p.id = e.property_id

        LEFT JOIN tenants t
          ON t.id = e.tenant_id

        WHERE e.id = ?
        `,
                [result.lastID]
            );

            res.status(201).json({
                success: true,
                message: "Transaction created successfully.",
                data: entry,
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // UPDATE entry
    app.put(`${API_BASE}/entries/:id`, async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid entry ID.",
                });
            }

            const existing = await get(
                `
        SELECT *
        FROM entries
        WHERE id = ?
        `,
                [Number(id)]
            );

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: "Entry not found.",
                });
            }

            if (existing.status === "VOID") {
                return res.status(400).json({
                    success: false,
                    message: "Void transactions cannot be edited.",
                });
            }

            const {
                entry_date,
                entry_type,
                property_id,
                tenant_id,
                category,
                amount,
                payment_mode,
                reference_no,
                notes,
                status,
            } = req.body || {};

            const entryType =
                entry_type === "COLLECTION" || entry_type === "EXPENSE"
                    ? entry_type
                    : existing.entry_type;

            const selectedPropertyId =
                isValidId(property_id)
                    ? Number(property_id)
                    : existing.property_id;

            const property = await get(
                `
        SELECT id
        FROM properties
        WHERE id = ?
        `,
                [selectedPropertyId]
            );

            if (!property) {
                return res.status(400).json({
                    success: false,
                    message: "Selected property does not exist.",
                });
            }

            let tenantId = existing.tenant_id;

            if (
                tenant_id === null ||
                tenant_id === undefined ||
                tenant_id === ""
            ) {
                tenantId = null;
            } else if (isValidId(tenant_id)) {
                const tenant = await get(
                    `
          SELECT id
          FROM tenants
          WHERE id = ?
          `,
                    [Number(tenant_id)]
                );

                if (!tenant) {
                    return res.status(400).json({
                        success: false,
                        message: "Selected tenant does not exist.",
                    });
                }

                tenantId = Number(tenant_id);
            }

            const transactionCategory =
                cleanString(category) || existing.category;

            const transactionAmount =
                amount === undefined || amount === null || amount === ""
                    ? existing.amount
                    : toNumber(amount);

            if (transactionAmount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Amount must be greater than zero.",
                });
            }

            let entryStatus = existing.status;

            if (status === "POSTED" || status === "VOID") {
                entryStatus = status;
            }

            await run(
                `
        UPDATE entries
        SET
          entry_date = ?,
          entry_type = ?,
          property_id = ?,
          tenant_id = ?,
          category = ?,
          amount = ?,
          payment_mode = ?,
          reference_no = ?,
          notes = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
                [
                    normalizeDate(entry_date) || existing.entry_date,
                    entryType,
                    selectedPropertyId,
                    tenantId,
                    transactionCategory,
                    transactionAmount,
                    cleanString(payment_mode),
                    cleanString(reference_no),
                    cleanString(notes),
                    entryStatus,
                    Number(id),
                ]
            );

            const entry = await get(
                `
        SELECT
          e.*,

          p.property_code,
          p.property_name,

          t.tenant_name

        FROM entries e

        INNER JOIN properties p
          ON p.id = e.property_id

        LEFT JOIN tenants t
          ON t.id = e.tenant_id

        WHERE e.id = ?
        `,
                [Number(id)]
            );

            res.json({
                success: true,
                message: "Transaction updated successfully.",
                data: entry,
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // DELETE entry = VOID TRANSACTION
    app.delete(`${API_BASE}/entries/:id`, async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid entry ID.",
                });
            }

            const entry = await get(
                `
        SELECT *
        FROM entries
        WHERE id = ?
        `,
                [Number(id)]
            );

            if (!entry) {
                return res.status(404).json({
                    success: false,
                    message: "Entry not found.",
                });
            }

            if (entry.status === "VOID") {
                return res.json({
                    success: true,
                    message: "Transaction is already void.",
                });
            }

            await run(
                `
        UPDATE entries
        SET
          status = 'VOID',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
                [Number(id)]
            );

            res.json({
                success: true,
                message: "Transaction voided successfully.",
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // ---------------------------------------------------------------------------
    // MASTER / DROPDOWN DATA
    // ---------------------------------------------------------------------------

    app.get(`${API_BASE}/masters`, async (req, res) => {
        try {
            const properties = await all(
                `
        SELECT
          id,
          property_code,
          property_name,
          location
        FROM properties
        WHERE status = 'ACTIVE'
        ORDER BY property_name COLLATE NOCASE ASC
        `
            );

            const tenants = await all(
                `
        SELECT
          t.id,
          t.tenant_name,
          t.tenant_phone,
          t.property_id,
          p.property_name,
          t.rent_amount
        FROM tenants t
        INNER JOIN properties p
          ON p.id = t.property_id
        WHERE t.status = 'ACTIVE'
        ORDER BY t.tenant_name COLLATE NOCASE ASC
        `
            );

            res.json({
                success: true,

                data: {
                    types: MASTER_VALUES.TYPES,

                    collection_categories:
                        MASTER_VALUES.COLLECTION_CATEGORIES,

                    expense_categories:
                        MASTER_VALUES.EXPENSE_CATEGORIES,

                    payment_modes:
                        MASTER_VALUES.PAYMENT_MODES,

                    properties,

                    tenants,
                },
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // GET tenants for selected property
    app.get(`${API_BASE}/masters/tenants`, async (req, res) => {
        try {
            const propertyId = req.query.property_id;

            if (!isValidId(propertyId)) {
                return res.status(400).json({
                    success: false,
                    message: "Valid property_id is required.",
                });
            }

            const tenants = await all(
                `
        SELECT
          id,
          tenant_name,
          tenant_phone,
          property_id,
          rent_amount,
          deposit_amount,
          agreement_start_date,
          agreement_end_date,
          status
        FROM tenants
        WHERE property_id = ?
          AND status = 'ACTIVE'
        ORDER BY tenant_name COLLATE NOCASE ASC
        `,
                [Number(propertyId)]
            );

            res.json({
                success: true,
                data: tenants,
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // ---------------------------------------------------------------------------
    // DASHBOARD HELPERS
    // ---------------------------------------------------------------------------

    async function getDashboardSummary(fromDate, toDate) {
        const summary = await get(
            `
      SELECT

        COALESCE(
          SUM(
            CASE
              WHEN entry_type = 'COLLECTION'
               AND status = 'POSTED'
              THEN amount
              ELSE 0
            END
          ),
          0
        ) AS total_collection,

        COALESCE(
          SUM(
            CASE
              WHEN entry_type = 'EXPENSE'
               AND status = 'POSTED'
              THEN amount
              ELSE 0
            END
          ),
          0
        ) AS total_expense,

        COUNT(
          CASE
            WHEN status = 'POSTED'
            THEN 1
          END
        ) AS transaction_count

      FROM entries

      WHERE entry_date >= ?
        AND entry_date <= ?
      `,
            [fromDate, toDate]
        );

        const totalCollection =
            Number(summary?.total_collection || 0);

        const totalExpense =
            Number(summary?.total_expense || 0);

        return {
            total_collection: totalCollection,
            total_expense: totalExpense,
            net_collection: totalCollection - totalExpense,
            transaction_count: Number(
                summary?.transaction_count || 0
            ),
        };
    }

    // ---------------------------------------------------------------------------
    // DASHBOARD MONTHLY
    // ---------------------------------------------------------------------------

    app.get(`${API_BASE}/dashboard/monthly`, async (req, res) => {
        try {
            const month =
                cleanString(req.query.month) || getCurrentMonth();

            if (!validateMonth(month)) {
                return res.status(400).json({
                    success: false,
                    message: "Month must be in YYYY-MM format.",
                });
            }

            const [year, monthNumber] = month
                .split("-")
                .map(Number);

            const firstDay = `${year}-${String(monthNumber).padStart(
                2,
                "0"
            )}-01`;

            const lastDate = new Date(
                year,
                monthNumber,
                0
            ).getDate();

            const lastDay = `${year}-${String(monthNumber).padStart(
                2,
                "0"
            )}-${String(lastDate).padStart(2, "0")}`;

            const summary = await getDashboardSummary(
                firstDay,
                lastDay
            );

            const propertyWise = await all(
                `
        SELECT
          p.id AS property_id,
          p.property_code,
          p.property_name,

          COALESCE(
            SUM(
              CASE
                WHEN e.entry_type = 'COLLECTION'
                 AND e.status = 'POSTED'
                THEN e.amount
                ELSE 0
              END
            ),
            0
          ) AS collection,

          COALESCE(
            SUM(
              CASE
                WHEN e.entry_type = 'EXPENSE'
                 AND e.status = 'POSTED'
                THEN e.amount
                ELSE 0
              END
            ),
            0
          ) AS expense

        FROM properties p

        LEFT JOIN entries e
          ON e.property_id = p.id
          AND e.entry_date >= ?
          AND e.entry_date <= ?

        WHERE p.status = 'ACTIVE'

        GROUP BY
          p.id,
          p.property_code,
          p.property_name

        ORDER BY
          p.property_name COLLATE NOCASE ASC
        `,
                [firstDay, lastDay]
            );

            const propertyWiseFormatted = propertyWise.map(
                (item) => ({
                    ...item,
                    collection: Number(item.collection || 0),
                    expense: Number(item.expense || 0),
                    net: Number(item.collection || 0) -
                        Number(item.expense || 0),
                })
            );

            const recentEntries = await all(
                `
        SELECT
          e.id,
          e.transaction_id,
          e.entry_date,
          e.entry_type,
          e.category,
          e.amount,
          e.payment_mode,
          e.status,

          p.property_name,

          t.tenant_name

        FROM entries e

        INNER JOIN properties p
          ON p.id = e.property_id

        LEFT JOIN tenants t
          ON t.id = e.tenant_id

        WHERE e.entry_date >= ?
          AND e.entry_date <= ?

        ORDER BY
          e.entry_date DESC,
          e.id DESC

        LIMIT 20
        `,
                [firstDay, lastDay]
            );

            res.json({
                success: true,

                data: {
                    month,

                    from_date: firstDay,

                    to_date: lastDay,

                    summary,

                    property_wise: propertyWiseFormatted,

                    recent_entries: recentEntries,
                },
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // ---------------------------------------------------------------------------
    // DASHBOARD YEARLY
    // ---------------------------------------------------------------------------

    app.get(`${API_BASE}/dashboard/yearly`, async (req, res) => {
        try {
            const year = req.query.year
                ? Number(req.query.year)
                : getCurrentYear();

            if (!validateYear(year)) {
                return res.status(400).json({
                    success: false,
                    message: "Year must be between 2000 and 2100.",
                });
            }

            const firstDay = `${year}-01-01`;
            const lastDay = `${year}-12-31`;

            const summary = await getDashboardSummary(
                firstDay,
                lastDay
            );

            const monthlyBreakdown = await all(
                `
        SELECT
          strftime('%Y-%m', entry_date) AS month,

          COALESCE(
            SUM(
              CASE
                WHEN entry_type = 'COLLECTION'
                 AND status = 'POSTED'
                THEN amount
                ELSE 0
              END
            ),
            0
          ) AS collection,

          COALESCE(
            SUM(
              CASE
                WHEN entry_type = 'EXPENSE'
                 AND status = 'POSTED'
                THEN amount
                ELSE 0
              END
            ),
            0
          ) AS expense

        FROM entries

        WHERE entry_date >= ?
          AND entry_date <= ?

        GROUP BY
          strftime('%Y-%m', entry_date)

        ORDER BY
          month ASC
        `,
                [firstDay, lastDay]
            );

            const monthlyMap = {};

            monthlyBreakdown.forEach((row) => {
                monthlyMap[row.month] = {
                    month: row.month,
                    collection: Number(row.collection || 0),
                    expense: Number(row.expense || 0),
                    net:
                        Number(row.collection || 0) -
                        Number(row.expense || 0),
                };
            });

            const completeMonthlyBreakdown = [];

            for (let month = 1; month <= 12; month++) {
                const monthString = String(month).padStart(2, "0");

                const key = `${year}-${monthString}`;

                if (monthlyMap[key]) {
                    completeMonthlyBreakdown.push(
                        monthlyMap[key]
                    );
                } else {
                    completeMonthlyBreakdown.push({
                        month: key,
                        collection: 0,
                        expense: 0,
                        net: 0,
                    });
                }
            }

            res.json({
                success: true,

                data: {
                    year,

                    from_date: firstDay,

                    to_date: lastDay,

                    summary,

                    monthly_breakdown:
                        completeMonthlyBreakdown,
                },
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // ---------------------------------------------------------------------------
    // DASHBOARD PROPERTY-WISE
    // ---------------------------------------------------------------------------

    app.get(
        `${API_BASE}/dashboard/property-wise`,
        async (req, res) => {
            try {
                let fromDate;
                let toDate;

                if (req.query.month) {
                    const month = String(req.query.month);

                    if (!validateMonth(month)) {
                        return res.status(400).json({
                            success: false,
                            message: "Month must be in YYYY-MM format.",
                        });
                    }

                    const [year, monthNumber] = month
                        .split("-")
                        .map(Number);

                    const lastDate = new Date(
                        year,
                        monthNumber,
                        0
                    ).getDate();

                    fromDate = `${year}-${String(monthNumber).padStart(
                        2,
                        "0"
                    )}-01`;

                    toDate = `${year}-${String(monthNumber).padStart(
                        2,
                        "0"
                    )}-${String(lastDate).padStart(2, "0")}`;
                } else if (req.query.year) {
                    const year = Number(req.query.year);

                    if (!validateYear(year)) {
                        return res.status(400).json({
                            success: false,
                            message: "Invalid year.",
                        });
                    }

                    fromDate = `${year}-01-01`;
                    toDate = `${year}-12-31`;
                } else {
                    const currentMonth = getCurrentMonth();

                    const [year, monthNumber] = currentMonth
                        .split("-")
                        .map(Number);

                    const lastDate = new Date(
                        year,
                        monthNumber,
                        0
                    ).getDate();

                    fromDate = `${year}-${String(monthNumber).padStart(
                        2,
                        "0"
                    )}-01`;

                    toDate = `${year}-${String(monthNumber).padStart(
                        2,
                        "0"
                    )}-${String(lastDate).padStart(2, "0")}`;
                }

                const rows = await all(
                    `
          SELECT
            p.id AS property_id,
            p.property_code,
            p.property_name,
            p.location,

            COALESCE(
              SUM(
                CASE
                  WHEN e.entry_type = 'COLLECTION'
                   AND e.status = 'POSTED'
                  THEN e.amount
                  ELSE 0
                END
              ),
              0
            ) AS collection,

            COALESCE(
              SUM(
                CASE
                  WHEN e.entry_type = 'EXPENSE'
                   AND e.status = 'POSTED'
                  THEN e.amount
                  ELSE 0
                END
              ),
              0
            ) AS expense,

            COUNT(
              CASE
                WHEN e.status = 'POSTED'
                THEN 1
              END
            ) AS transaction_count

          FROM properties p

          LEFT JOIN entries e
            ON e.property_id = p.id
            AND e.entry_date >= ?
            AND e.entry_date <= ?

          WHERE p.status = 'ACTIVE'

          GROUP BY
            p.id,
            p.property_code,
            p.property_name,
            p.location

          ORDER BY
            p.property_name COLLATE NOCASE ASC
          `,
                    [fromDate, toDate]
                );

                const data = rows.map((row) => ({
                    ...row,

                    collection: Number(row.collection || 0),

                    expense: Number(row.expense || 0),

                    net:
                        Number(row.collection || 0) -
                        Number(row.expense || 0),

                    transaction_count:
                        Number(row.transaction_count || 0),
                }));

                res.json({
                    success: true,

                    data: {
                        from_date: fromDate,

                        to_date: toDate,

                        properties: data,
                    },
                });
            } catch (error) {
                sendError(res, error);
            }
        }
    );

    // ---------------------------------------------------------------------------
    // TENANT OVERDUE
    // ---------------------------------------------------------------------------

    app.get(
        `${API_BASE}/dashboard/tenant-overdue`,
        async (req, res) => {
            try {
                const tenants = await all(
                    `
          SELECT
            t.id,
            t.tenant_name,
            t.tenant_phone,
            t.property_id,
            p.property_name,
            p.property_code,
            t.agreement_start_date,
            t.agreement_end_date,
            t.rent_amount,

            COALESCE(
              (
                SELECT SUM(e.amount)
                FROM entries e
                WHERE e.tenant_id = t.id
                  AND e.entry_type = 'COLLECTION'
                  AND e.category = 'RENT_COLLECTION'
                  AND e.status = 'POSTED'
              ),
              0
            ) AS total_rent_collected

          FROM tenants t

          INNER JOIN properties p
            ON p.id = t.property_id

          WHERE t.status = 'ACTIVE'

          ORDER BY
            t.tenant_name COLLATE NOCASE ASC
          `
                );

                const today = new Date();

                const result = tenants.map((tenant) => {
                    const rent = Number(tenant.rent_amount || 0);

                    let expectedMonths = 0;

                    if (tenant.agreement_start_date) {
                        const start = new Date(
                            `${tenant.agreement_start_date}T00:00:00`
                        );

                        let end = today;

                        if (tenant.agreement_end_date) {
                            const agreementEnd = new Date(
                                `${tenant.agreement_end_date}T00:00:00`
                            );

                            if (agreementEnd < end) {
                                end = agreementEnd;
                            }
                        }

                        if (start <= end) {
                            expectedMonths =
                                (end.getFullYear() - start.getFullYear()) * 12 +
                                (end.getMonth() - start.getMonth()) +
                                1;
                        }
                    }

                    const expectedRent =
                        expectedMonths * rent;

                    const collected =
                        Number(tenant.total_rent_collected || 0);

                    const overdue =
                        Math.max(
                            expectedRent - collected,
                            0
                        );

                    return {
                        ...tenant,

                        rent_amount: rent,

                        expected_months: expectedMonths,

                        expected_rent: expectedRent,

                        total_rent_collected: collected,

                        overdue_amount: overdue,
                    };
                });

                res.json({
                    success: true,

                    data: result,
                });
            } catch (error) {
                sendError(res, error);
            }
        }
    );

    // ---------------------------------------------------------------------------
    // Initialization promise
    //
    // Main index.js can optionally wait for:
    //
    //   await app.tenantRentManagementReady;
    //
    // ---------------------------------------------------------------------------

    app.tenantRentManagementReady = initializeDatabase()
        .then(() => {
            console.log(
                "Tenant/Rent Management module ready."
            );

            return true;
        })
        .catch((error) => {
            console.error(
                "Tenant/Rent Management initialization failed:",
                error
            );

            throw error;
        });

    return {
        ready: app.tenantRentManagementReady,

        masters: MASTER_VALUES,
    };
};