# Modular Bill + Tenant Server with Complete Database Backup/Restore

## Server files

- `index.js` - Express startup, SQLite connection, module registration, Angular static hosting.
- `bill.js` - bill, bill-item, purchase, party and report/query APIs.
- `tenant.js` - property, tenant, rent/expense/transaction APIs.
- `backup.js` - complete database backup/restore APIs, automatic backup, saved backup files and Git backup.
- `reference/tenantRentManagement(2).js` - original alternate tenant module kept only for reference; it is NOT loaded.

## Complete database backup

The new backup module does not maintain a hard-coded list of business tables.
It dynamically reads every non-internal SQLite table from `sqlite_master` and stores:

- table name
- CREATE TABLE SQL
- column definitions
- primary keys
- foreign keys
- every row in every table

Therefore new application tables are automatically included in future backups.

Backup format:

`*.dbbackup.json`

The file is intentionally JSON so Angular can read it directly and let the user choose individual records before restore.

## Backup APIs

- `GET /api/backup` - create and download a complete database backup.
- `GET /api/backup/summary` - current table/record summary.
- `GET /api/backup/files` - list saved backup files.
- `GET /api/backup/files/:filename` - download a saved backup.
- `DELETE /api/backup/files/:filename` - delete a saved backup.
- `POST /api/backup/inspect` - validate a backup object uploaded by Angular.
- `POST /api/restore/selected` - restore only selected records.
- `POST /api/restore` - restore all records from a v3 complete backup.

Before restore, the server creates a safety backup.
Foreign-key checks remain enabled and selected child records are checked against their required parent records.

## Angular page

Location in this package:

`angular/backup-restore/`

Files:

- `backup-restore.component.ts`
- `backup-restore.component.html`
- `backup-restore.component.css`

The page provides:

- Create Full Backup button.
- Backup file selection.
- Tables shown after selecting a backup.
- All tables/records selected by default.
- Select/unselect all.
- Select/unselect an entire table.
- Select/unselect individual records.
- Record counts per table.
- Restore Selected button.
- Foreign-key error messages from the server.

Example route:

```ts
{ path: 'backup-restore', component: BackupRestoreComponent }
```

## Important

The existing SQLite database file (`bills.db`) is not replaced by this package. Keep your existing database file in the server directory.

The package was syntax checked with `node --check` for all server JavaScript files. Full runtime testing requires the project's installed Node dependencies, especially `better-sqlite3`.
