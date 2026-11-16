import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface BackupColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

interface BackupTable {
  name: string;
  sql: string | null;
  columns: BackupColumn[];
  foreignKeys: any[];
  primaryKey: string[];
  rows: Record<string, any>[];
}

interface BackupFile {
  format: string;
  version: string;
  exportedAt: string;
  reason?: string;
  database?: string;
  totalTables: number;
  totalRecords: number;
  tables: BackupTable[];
}

@Component({
  selector: 'app-backup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './backup.component.html',
  styleUrls: ['./backup.component.scss']
})
export class BackupComponent {
  readonly apiBase = '/api';

  backup: BackupFile | null = null;
  serverBackups: any[] = [];
  expanded: Record<string, boolean> = {};
  selected: Record<string, Set<number>> = {};

  loading = false;
  restoring = false;
  message = '';
  error = '';

  async downloadBackup(): Promise<void> {
    this.clearMessages();
    this.loading = true;
    try {
      const response = await fetch(`${this.apiBase}/backup`);
      if (!response.ok) throw new Error(await this.readError(response));

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || 'database-backup.dbbackup.json';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      this.message = 'Complete database backup downloaded successfully.';
      await this.loadServerBackups();
    } catch (e: any) {
      this.error = e?.message || 'Backup failed.';
    } finally {
      this.loading = false;
    }
  }

  async loadServerBackups(): Promise<void> {
    try {
      const response = await fetch(`${this.apiBase}/backup/files`);
      if (!response.ok) return;
      this.serverBackups = await response.json();
    } catch (_) {
      // The backup page can still work using an uploaded file.
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    this.clearMessages();
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupFile;
      this.validateBackup(parsed);
      this.backup = parsed;
      this.initialiseSelection();
      this.message = `${file.name} loaded. All tables and records are selected by default.`;
    } catch (e: any) {
      this.backup = null;
      this.error = e?.message || 'Invalid backup file.';
    }

    input.value = '';
  }

  validateBackup(data: BackupFile): void {
    if (!data || data.format !== 'complete-sqlite-database-backup') {
      throw new Error('This is not a supported complete database backup file.');
    }
    if (!Array.isArray(data.tables)) {
      throw new Error('Backup file does not contain table data.');
    }
  }

  initialiseSelection(): void {
    this.selected = {};
    this.expanded = {};
    for (const table of this.backup?.tables || []) {
      this.selected[table.name] = new Set(table.rows.map((_, index) => index));
      this.expanded[table.name] = false;
    }
  }

  isTableSelected(table: BackupTable): boolean {
    return !!this.selected[table.name] && this.selected[table.name].size === table.rows.length && table.rows.length > 0;
  }

  isTablePartiallySelected(table: BackupTable): boolean {
    const count = this.selected[table.name]?.size || 0;
    return count > 0 && count < table.rows.length;
  }

  isRowSelected(table: BackupTable, index: number): boolean {
    return this.selected[table.name]?.has(index) || false;
  }

  toggleTable(table: BackupTable): void {
    if (!this.selected[table.name]) this.selected[table.name] = new Set<number>();
    if (this.isTableSelected(table)) {
      this.selected[table.name].clear();
    } else {
      this.selected[table.name] = new Set(table.rows.map((_, i) => i));
    }
  }

  toggleRow(table: BackupTable, index: number): void {
    const set = this.selected[table.name] || new Set<number>();
    if (set.has(index)) set.delete(index); else set.add(index);
    this.selected[table.name] = set;
  }

  allSelected(): boolean {
    if (!this.backup?.tables.length) return false;
    return this.backup.tables.every(t => this.isTableSelected(t));
  }

  toggleAll(): void {
    if (!this.backup) return;
    const select = !this.allSelected();
    for (const table of this.backup.tables) {
      this.selected[table.name] = select
        ? new Set(table.rows.map((_, i) => i))
        : new Set<number>();
    }
  }

  toggleExpanded(table: BackupTable): void {
    this.expanded[table.name] = !this.expanded[table.name];
  }

  selectedCount(table: BackupTable): number {
    return this.selected[table.name]?.size || 0;
  }

  totalSelected(): number {
    return Object.values(this.selected).reduce((total, set) => total + set.size, 0);
  }

  selectedRows(table: BackupTable): Record<string, any>[] {
    const indexes = this.selected[table.name] || new Set<number>();
    return [...indexes].map(i => table.rows[i]).filter(Boolean);
  }

  async restoreSelected(): Promise<void> {
    this.clearMessages();
    if (!this.backup) {
      this.error = 'Please select a backup file first.';
      return;
    }
    if (!this.totalSelected()) {
      this.error = 'Please select at least one record.';
      return;
    }

    const confirmed = window.confirm(
      `Restore ${this.totalSelected()} selected record(s)? A safety backup will be created before restore.`
    );
    if (!confirmed) return;

    this.restoring = true;
    try {
      const selected: Record<string, Record<string, any>[]> = {};
      for (const table of this.backup.tables) {
        const rows = this.selectedRows(table);
        if (rows.length) selected[table.name] = rows;
      }

      const response = await fetch(`${this.apiBase}/restore/selected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup: this.backup, selected })
      });

      if (!response.ok) throw new Error(await this.readError(response));
      const result = await response.json();
      this.message = `${result.message} Restored ${result.totalSelected} record(s).`;
    } catch (e: any) {
      this.error = e?.message || 'Restore failed.';
    } finally {
      this.restoring = false;
    }
  }

  columns(table: BackupTable): BackupColumn[] {
    return table.columns || [];
  }

  displayValue(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  primaryLabel(table: BackupTable, row: Record<string, any>, index: number): string {
    const keys = table.primaryKey?.length ? table.primaryKey : ['id'];
    const value = keys.map(k => `${k}: ${this.displayValue(row[k])}`).join(' | ');
    return value || `Record ${index + 1}`;
  }

  private clearMessages(): void {
    this.message = '';
    this.error = '';
  }

  private async readError(response: Response): Promise<string> {
    try {
      const data = await response.json();
      return data.error || data.message || 'Server request failed.';
    } catch (_) {
      return `Server request failed (${response.status}).`;
    }
  }

  constructor() {
    this.loadServerBackups();
  }
}
