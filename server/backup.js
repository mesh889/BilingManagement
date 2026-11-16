'use strict';

/**
 * Complete SQLite backup / restore module.
 *
 * - Discovers every application table automatically.
 * - Creates a REAL .zip backup on server startup.
 * - Creates a new .zip when database contents change.
 * - Keeps a rolling local backup history.
 * - Keeps latest-database-backup.zip as the Git recovery copy.
 * - Automatically commits/pushes the latest ZIP when database data changes.
 * - ZIP contains backup.json (all tables + records + schema) and database.sqlite.
 * - No extra npm ZIP dependency is required; ZIP writing/reading uses Node built-ins.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const express = require('express');
const { execFileSync } = require('child_process');

module.exports = function registerBackup(app, db, options = {}) {
  if (!app || !db) throw new Error('app and db are required');

  const BASE = options.basePath || '/api';
  const DATABASE_PATH = options.databasePath || path.join(__dirname, 'bills.db');
  const BACKUP_DIR = options.backupDir || path.join(__dirname, 'backups');
  const MAX_BACKUPS = Number(options.maxBackups || 10);
  const CHANGE_CHECK_MS = Number(options.changeCheckMs || 5000);
  const GIT_REMOTE = options.gitRemote || 'origin';
  const GIT_BRANCH = options.gitBranch || 'main';
  const RESTORE_CACHE_DIR = path.join(BACKUP_DIR, 'restore-cache');

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!fs.existsSync(RESTORE_CACHE_DIR)) fs.mkdirSync(RESTORE_CACHE_DIR, { recursive: true });
  db.pragma('foreign_keys = ON');

  function quoteIdent(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }

  function getTableNames() {
    return db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map(r => r.name);
  }

  function getTableInfo(tableName, includeRows = true) {
    const safe = quoteIdent(tableName);
    const columns = db.prepare(`PRAGMA table_info(${safe})`).all();
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${safe})`).all();
    const indexes = db.prepare(`PRAGMA index_list(${safe})`).all().map(idx => ({
      ...idx,
      columns: db.prepare(`PRAGMA index_info(${quoteIdent(idx.name)})`).all()
    }));
    const sqlRow = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);

    return {
      name: tableName,
      sql: sqlRow?.sql || null,
      columns,
      foreignKeys,
      indexes,
      primaryKey: columns.filter(c => Number(c.pk) > 0)
        .sort((a, b) => a.pk - b.pk).map(c => c.name),
      rows: includeRows ? db.prepare(`SELECT * FROM ${safe}`).all() : []
    };
  }

  function buildBackup(reason = 'manual') {
    const tables = getTableNames().map(name => getTableInfo(name, true));
    return {
      format: 'complete-sqlite-database-backup',
      version: '4.0',
      exportedAt: new Date().toISOString(),
      reason,
      database: path.basename(DATABASE_PATH),
      totalTables: tables.length,
      totalRecords: tables.reduce((n, t) => n + t.rows.length, 0),
      tables
    };
  }

  function stableSnapshot(backup) {
    return JSON.stringify({
      database: backup.database,
      tables: backup.tables.map(t => ({
        name: t.name,
        sql: t.sql,
        columns: t.columns,
        foreignKeys: t.foreignKeys,
        indexes: t.indexes,
        primaryKey: t.primaryKey,
        rows: t.rows
      }))
    });
  }

  // ---------- Minimal ZIP writer/reader (Node built-ins only) ----------
  function crc32(buffer) {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i];
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; }
  function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

  function makeZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const name = Buffer.from(entry.name, 'utf8');
      const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
      const compressed = zlib.deflateRawSync(raw, { level: zlib.constants.Z_BEST_COMPRESSION });
      const crc = crc32(raw);

      const local = Buffer.concat([
        u32(0x04034b50), u16(20), u16(0), u16(8),
        u16(0), u16(0), u32(crc), u32(compressed.length), u32(raw.length),
        u16(name.length), u16(0), name, compressed
      ]);
      localParts.push(local);

      const central = Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(8),
        u16(0), u16(0), u32(crc), u32(compressed.length), u32(raw.length),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset),
        name
      ]);
      centralParts.push(central);
      offset += local.length;
    }

    const central = Buffer.concat(centralParts);
    const locals = Buffer.concat(localParts);
    const end = Buffer.concat([
      u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
      u32(central.length), u32(locals.length), u16(0)
    ]);
    return Buffer.concat([locals, central, end]);
  }

  function readZip(buffer) {
    const entries = new Map();
    const eocdSig = 0x06054b50;
    let eocd = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
      if (buffer.readUInt32LE(i) === eocdSig) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Invalid ZIP: end of central directory not found.');

    const count = buffer.readUInt16LE(eocd + 10);
    const centralOffset = buffer.readUInt32LE(eocd + 16);
    let p = centralOffset;

    for (let i = 0; i < count; i++) {
      if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('Invalid ZIP central directory.');
      const method = buffer.readUInt16LE(p + 10);
      const compressedSize = buffer.readUInt32LE(p + 20);
      const nameLen = buffer.readUInt16LE(p + 28);
      const extraLen = buffer.readUInt16LE(p + 30);
      const commentLen = buffer.readUInt16LE(p + 32);
      const localOffset = buffer.readUInt32LE(p + 42);
      const name = buffer.subarray(p + 46, p + 46 + nameLen).toString('utf8');

      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP local header.');
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      let data;
      if (method === 0) data = Buffer.from(compressed);
      else if (method === 8) data = zlib.inflateRawSync(compressed);
      else throw new Error(`Unsupported ZIP compression method: ${method}`);

      entries.set(name, data);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  function createZipBuffer(backup) {
    const dbCopy = fs.readFileSync(DATABASE_PATH);
    const backupJson = Buffer.from(JSON.stringify(backup, null, 2), 'utf8');
    const manifest = Buffer.from(JSON.stringify({
      format: backup.format,
      version: backup.version,
      exportedAt: backup.exportedAt,
      reason: backup.reason,
      database: backup.database,
      totalTables: backup.totalTables,
      totalRecords: backup.totalRecords,
      files: ['backup.json', 'database.sqlite']
    }, null, 2), 'utf8');

    return makeZip([
      { name: 'manifest.json', data: manifest },
      { name: 'backup.json', data: backupJson },
      { name: 'database.sqlite', data: dbCopy }
    ]);
  }

  function backupFromZipBuffer(zipBuffer) {
    const entries = readZip(zipBuffer);
    const json = entries.get('backup.json');
    if (!json) throw new Error('ZIP does not contain backup.json.');
    const backup = JSON.parse(json.toString('utf8'));
    validateBackup(backup);
    return { backup, entries };
  }

  function timestampName(prefix = 'database-backup') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${prefix}-${stamp}.zip`;
  }

  function saveZipBackup(backup, prefix = 'database-backup') {
    const filename = timestampName(prefix);
    const filepath = path.join(BACKUP_DIR, filename);
    const latestPath = path.join(BACKUP_DIR, 'latest-database-backup.zip');
    const zip = createZipBuffer(backup);
    fs.writeFileSync(filepath, zip);
    fs.writeFileSync(latestPath, zip);
    pruneBackups();
    return { filename, filepath, latestPath, size: zip.length };
  }

  function pruneBackups() {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^(database-backup|manual-backup|safety-backup|git-backup)-.*\.zip$/.test(f))
      .map(name => ({ name, path: path.join(BACKUP_DIR, name), mtime: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    files.slice(MAX_BACKUPS).forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
  }

  function getBackupFiles() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.zip'))
      .map(filename => {
        const filepath = path.join(BACKUP_DIR, filename);
        const stat = fs.statSync(filepath);
        let summary = {};
        try {
          const { backup } = backupFromZipBuffer(fs.readFileSync(filepath));
          summary = { totalTables: backup.totalTables, totalRecords: backup.totalRecords, version: backup.version };
        } catch (_) {}
        return { filename, size: stat.size, createdAt: stat.mtime.toISOString(), ...summary };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function validateBackup(backup) {
    if (!backup || typeof backup !== 'object') throw new Error('Invalid backup object.');
    if (!Array.isArray(backup.tables)) throw new Error('Invalid backup format: tables are missing.');
    if (backup.format !== 'complete-sqlite-database-backup') throw new Error('Unsupported backup format.');
    for (const table of backup.tables) {
      if (!table.name || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
        throw new Error(`Invalid table data for ${table.name || 'unknown table'}.`);
      }
    }
    return true;
  }

  function currentRowByPrimaryKey(tableName, table, row) {
    const keys = Array.isArray(table.primaryKey) ? table.primaryKey : [];
    if (!keys.length) return null;
    const where = keys.map(k => `${quoteIdent(k)} = ?`).join(' AND ');
    return db.prepare(`SELECT * FROM ${quoteIdent(tableName)} WHERE ${where}`).get(...keys.map(k => row[k])) || null;
  }

  function restoreTableRows(table, rows) {
    const tableName = table.name;
    const currentTables = new Set(getTableNames());
    if (!currentTables.has(tableName)) {
      if (!table.sql) throw new Error(`Table ${tableName} does not exist and backup has no schema SQL.`);
      db.exec(table.sql);
    }

    const liveColumns = db.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all();
    const liveNames = new Set(liveColumns.map(c => c.name));

    for (const row of rows) {
      const keys = Object.keys(row).filter(k => liveNames.has(k));
      if (!keys.length) continue;
      const existing = currentRowByPrimaryKey(tableName, table, row);
      if (existing && table.primaryKey?.length) {
        const updateColumns = keys.filter(k => !table.primaryKey.includes(k));
        if (updateColumns.length) {
          const setSql = updateColumns.map(k => `${quoteIdent(k)} = ?`).join(', ');
          const whereSql = table.primaryKey.map(k => `${quoteIdent(k)} = ?`).join(' AND ');
          db.prepare(`UPDATE ${quoteIdent(tableName)} SET ${setSql} WHERE ${whereSql}`)
            .run(...updateColumns.map(k => row[k]), ...table.primaryKey.map(k => row[k]));
        }
      } else {
        const columnsSql = keys.map(quoteIdent).join(', ');
        const placeholders = keys.map(() => '?').join(', ');
        db.prepare(`INSERT INTO ${quoteIdent(tableName)} (${columnsSql}) VALUES (${placeholders})`).run(...keys.map(k => row[k]));
      }
    }
  }

  function dependencyOrder(backup, selected) {
    const byName = new Map(backup.tables.map(t => [t.name, t]));
    const needed = new Set(Object.keys(selected).filter(name => Array.isArray(selected[name]) && selected[name].length));
    const result = [], visiting = new Set(), visited = new Set();
    function visit(name) {
      if (!needed.has(name) || visited.has(name)) return;
      if (visiting.has(name)) return;
      visiting.add(name);
      (byName.get(name)?.foreignKeys || []).forEach(fk => visit(fk.table));
      visiting.delete(name);
      visited.add(name);
      result.push(name);
    }
    needed.forEach(visit);
    return result;
  }

  function validateForeignKeyDependencies(backup, selected) {
    const selectedRows = new Map(Object.entries(selected).filter(([, rows]) => Array.isArray(rows)));
    const backupMap = new Map(backup.tables.map(t => [t.name, t]));
    for (const [tableName, rows] of selectedRows) {
      const table = backupMap.get(tableName);
      if (!table) throw new Error(`Table ${tableName} is not present in the backup.`);
      for (const row of rows) {
        for (const fk of table.foreignKeys || []) {
          const value = row[fk.from];
          if (value == null) continue;
          const parentRows = selectedRows.get(fk.table) || [];
          const selectedParent = parentRows.some(pr => String(pr[fk.to]) === String(value));
          const parentExists = getTableNames().includes(fk.table) &&
            !!db.prepare(`SELECT 1 FROM ${quoteIdent(fk.table)} WHERE ${quoteIdent(fk.to)} = ? LIMIT 1`).get(value);
          if (!selectedParent && !parentExists) {
            throw new Error(`Cannot restore ${tableName}: required ${fk.table}.${fk.to}=${value} is not selected and does not exist in the current database.`);
          }
        }
      }
    }
  }

  function createSafetyBackup(reason) {
    try { return saveZipBackup(buildBackup(reason), 'safety-backup'); }
    catch (err) { console.error('[BACKUP] Safety backup failed:', err.message); return null; }
  }

  function gitBackup(reason = 'database-changed', backup = null) {
    try {
      const current = backup || buildBackup(reason);
      const zip = createZipBuffer(current);
      const latestPath = path.join(BACKUP_DIR, 'latest-database-backup.zip');

      // Hash only the actual database contents/schema. This prevents a new
      // Git commit merely because exportedAt/reason/ZIP metadata changed.
      const newHash = crypto.createHash('sha256').update(stableSnapshot(current)).digest('hex');
      const hashFile = path.join(BACKUP_DIR, 'latest-database-backup.sha256');
      const oldHash = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, 'utf8').trim() : '';

      fs.writeFileSync(latestPath, zip);
      if (newHash === oldHash) {
        console.log('[GIT BACKUP] No database changes detected.');
        return { changed: false, hash: newHash };
      }

      fs.writeFileSync(hashFile, newHash + '\n', 'utf8');
      try {
        execFileSync('git', ['add', '-f', '--', path.relative(__dirname, latestPath), path.relative(__dirname, hashFile)], { cwd: __dirname, stdio: 'ignore' });
        execFileSync('git', ['commit', '-m', `Database backup ${new Date().toISOString()}`], { cwd: __dirname, stdio: 'ignore' });
        execFileSync('git', ['push', GIT_REMOTE, GIT_BRANCH], { cwd: __dirname, stdio: 'ignore' });
        console.log('[GIT BACKUP] Database backup committed and pushed.');
      } catch (gitErr) {
        console.warn('[GIT BACKUP] Git operation failed/skipped:', gitErr.message);
      }
      return { changed: true, hash: newHash };
    } catch (err) {
      console.error('[GIT BACKUP] Failed:', err.message);
      return { changed: false, error: err.message };
    }
  }

  function createAndSave(reason, prefix = 'database-backup', pushGit = false) {
    const backup = buildBackup(reason);
    const saved = saveZipBackup(backup, prefix);
    if (pushGit) gitBackup(reason, backup);
    return { backup, saved };
  }

  // Manual complete ZIP backup.
  app.get(`${BASE}/backup`, (req, res) => {
    try {
      const { backup, saved } = createAndSave('manual', 'manual-backup', false);
      const zip = fs.readFileSync(saved.filepath);
      res.setHeader('Content-Disposition', `attachment; filename=${saved.filename}`);
      res.setHeader('Content-Type', 'application/zip');
      res.send(zip);
    } catch (err) {
      console.error('[BACKUP] Manual backup failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get(`${BASE}/backup/summary`, (req, res) => {
    try {
      const tables = getTableNames().map(name => {
        const t = getTableInfo(name, false);
        const records = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(name)}`).get().count;
        return { name: t.name, records, columns: t.columns, primaryKey: t.primaryKey, foreignKeys: t.foreignKeys };
      });
      res.json({ success: true, totalTables: tables.length, totalRecords: tables.reduce((n, t) => n + t.records, 0), tables });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get(`${BASE}/backup/files`, (req, res) => res.json(getBackupFiles()));

  app.get(`${BASE}/backup/files/:filename`, (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup file not found.' });
    res.download(filepath, filename);
  });

  app.delete(`${BASE}/backup/files/:filename`, (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup file not found.' });
    fs.unlinkSync(filepath);
    res.json({ success: true, message: 'Backup deleted.' });
  });

  // Inspect uploaded ZIP without restoring anything. The ZIP is cached temporarily so
  // the Angular page can send a small JSON selection on the restore request.
  app.post(`${BASE}/backup/inspect`, express.raw({ type: ['application/zip', 'application/octet-stream'], limit: '200mb' }), (req, res) => {
    try {
      const zipBuffer = req.body;
      const { backup } = backupFromZipBuffer(zipBuffer);
      const token = crypto.randomBytes(24).toString('hex');
      fs.writeFileSync(path.join(RESTORE_CACHE_DIR, `${token}.zip`), zipBuffer);
      const tables = backup.tables.map(t => ({ name: t.name, records: t.rows.length, columns: t.columns, primaryKey: t.primaryKey || [], foreignKeys: t.foreignKeys || [] }));
      res.json({ success: true, restoreToken: token, version: backup.version, exportedAt: backup.exportedAt, totalTables: tables.length, totalRecords: tables.reduce((n, t) => n + t.records, 0), tables, backup });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
  });

  // Restore selected records from a previously inspected ZIP.
  app.post(`${BASE}/restore/selected`, express.json({ limit: '100mb' }), (req, res) => {
    try {
      const token = String(req.body?.restoreToken || '');
      if (!/^[a-f0-9]{48}$/.test(token)) throw new Error('Invalid or missing restore token.');
      const selected = req.body?.selected;
      if (!selected || typeof selected !== 'object') throw new Error('Restore selection is missing.');
      const zipPath = path.join(RESTORE_CACHE_DIR, `${token}.zip`);
      if (!fs.existsSync(zipPath)) throw new Error('Restore session expired or backup ZIP is unavailable. Please select the backup again.');
      const { backup } = backupFromZipBuffer(fs.readFileSync(zipPath));
      validateForeignKeyDependencies(backup, selected);
      const selectedCounts = Object.fromEntries(Object.entries(selected).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
      const totalSelected = Object.values(selectedCounts).reduce((a, b) => a + b, 0);
      if (!totalSelected) throw new Error('No records selected for restore.');

      const safety = createSafetyBackup('pre-restore');
      const order = dependencyOrder(backup, selected);
      const tx = db.transaction(() => {
        for (const name of order) restoreTableRows(backup.tables.find(t => t.name === name), selected[name] || []);
      });
      tx();
      try { fs.unlinkSync(zipPath); } catch (_) {}
      gitBackup('restore-selected');
      res.json({ success: true, message: 'Selected database records restored successfully.', selectedCounts, totalSelected, safetyBackup: safety?.filename || null });
    } catch (err) {
      console.error('[RESTORE] Selected restore failed:', err);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Full restore endpoint for a ZIP. A safety backup is always made first.
  app.post(`${BASE}/restore`, express.raw({ type: ['application/zip', 'application/octet-stream'], limit: '200mb' }), (req, res) => {
    try {
      const { backup } = backupFromZipBuffer(req.body);
      const selected = Object.fromEntries(backup.tables.map(t => [t.name, t.rows]));
      validateForeignKeyDependencies(backup, selected);
      const safety = createSafetyBackup('pre-full-restore');
      const order = dependencyOrder(backup, selected);
      const tx = db.transaction(() => {
        for (const name of order) restoreTableRows(backup.tables.find(t => t.name === name), selected[name]);
      });
      tx();
      gitBackup('full-restore');
      res.json({ success: true, message: 'Complete database restore finished.', totalTables: backup.totalTables, totalRecords: backup.totalRecords, safetyBackup: safety?.filename || null });
    } catch (err) {
      console.error('[RESTORE] Full restore failed:', err);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ---------- Startup backup only ----------
  // Automatic backup is intentionally checked ONLY when the service starts.
  // There is no setInterval() and no continuous database polling.
  try {
    const startup = buildBackup('server-startup');
    const saved = saveZipBackup(startup, 'database-backup');
    console.log('[BACKUP] Startup complete database ZIP saved:', saved.filename);

    // Compare database CONTENT, not the ZIP bytes. ZIP metadata/timestamps and
    // exportedAt must not cause a false Git change on every service restart.
    gitBackup('server-startup', startup);
  } catch (err) {
    console.error('[BACKUP] Startup backup failed:', err.message);
  }

  return { apiBasePath: BASE };
};
