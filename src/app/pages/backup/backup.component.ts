import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BillService } from '../../services/bill.service';

@Component({
  selector: 'app-backup',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './backup.component.html',
  styleUrl: './backup.component.scss'
})
export class BackupComponent implements OnInit {
  private billService = inject(BillService);

  // Backup
  backupStatus = '';
  backupData: any = null;
  isBackingUp = false;

  // Saved files
  savedFiles: any[] = [];

  // Restore
  restoreStatus = '';
  restoreFile: File | null = null;
  restorePreview: any = null;
  clearExisting = false;
  isRestoring = false;
  selectedBills: Set<number> = new Set();

  ngOnInit() {
    this.loadSavedFiles();
  }

  loadSavedFiles() {
    this.billService.getBackupFiles().subscribe(files => this.savedFiles = files);
  }

  // === BACKUP ===
  createBackup() {
    this.isBackingUp = true;
    this.backupStatus = '';
    this.billService.backup().subscribe({
      next: (data) => {
        this.backupData = data;
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.savedAs || `bills-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.backupStatus = `Backup created! ${data.totalBills} bills + ${data.totalPurchases} purchases exported. Saved as: ${data.savedAs}`;
        this.isBackingUp = false;
        this.loadSavedFiles();
      },
      error: (err) => {
        this.backupStatus = 'Backup failed: ' + (err.error?.error || err.message);
        this.isBackingUp = false;
      }
    });
  }

  // === SAVED FILES ===
  downloadFile(filename: string) {
    this.billService.downloadBackupFile(filename).subscribe(data => {
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  deleteFile(filename: string) {
    if (!confirm(`Delete backup "${filename}"?`)) return;
    this.billService.deleteBackupFile(filename).subscribe(() => this.loadSavedFiles());
  }

  restoreFromSaved(filename: string) {
    this.billService.downloadBackupFile(filename).subscribe(data => {
      this.restorePreview = data;
      this.restoreFile = null;
      this.selectedBills.clear();
      if (data?.bills) {
        data.bills.forEach((_: any, i: number) => this.selectedBills.add(i));
      }
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // === RESTORE ===
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.restoreFile = input.files[0];
    this.restorePreview = null;
    this.restoreStatus = '';
    this.selectedBills.clear();

    const reader = new FileReader();
    reader.onload = () => {
      try {
        this.restorePreview = JSON.parse(reader.result as string);
        if (this.restorePreview?.bills) {
          this.restorePreview.bills.forEach((_: any, i: number) => this.selectedBills.add(i));
        }
      } catch {
        this.restoreStatus = 'Invalid JSON file.';
        this.restoreFile = null;
      }
    };
    reader.readAsText(this.restoreFile);
  }

  toggleBill(index: number) {
    if (this.selectedBills.has(index)) this.selectedBills.delete(index);
    else this.selectedBills.add(index);
  }

  get isAllSelected(): boolean {
    return this.restorePreview?.bills?.length > 0 && this.selectedBills.size === this.restorePreview.bills.length;
  }

  toggleSelectAll() {
    if (this.isAllSelected) this.selectedBills.clear();
    else this.restorePreview?.bills?.forEach((_: any, i: number) => this.selectedBills.add(i));
  }

  restoreBackup() {
    const hasBills = this.restorePreview?.bills && this.selectedBills.size > 0;
    const hasPurchases = this.restorePreview?.purchases?.length > 0;
    if (!hasBills && !hasPurchases) {
      this.restoreStatus = 'Nothing to restore.';
      return;
    }
    if (this.clearExisting && !confirm('This will DELETE all existing bills and purchases. Continue?')) return;
    const billsToRestore = hasBills ? this.restorePreview.bills.filter((_: any, i: number) => this.selectedBills.has(i)) : [];
    const purchasesToRestore = hasPurchases ? this.restorePreview.purchases : [];
    this.isRestoring = true;
    this.restoreStatus = '';
    this.billService.restore({ bills: billsToRestore, purchases: purchasesToRestore, clearExisting: this.clearExisting }).subscribe({
      next: (res: any) => {
        this.restoreStatus = `Restore successful! ${res.importedBills} bills + ${res.importedPurchases} purchases imported. Total: ${res.totalBillsNow} bills, ${res.totalPurchasesNow} purchases.`;
        this.isRestoring = false;
        this.restorePreview = null;
        this.restoreFile = null;
        this.selectedBills.clear();
      },
      error: (err: any) => {
        this.restoreStatus = 'Restore failed: ' + (err.error?.error || err.message);
        this.isRestoring = false;
      }
    });
  }
}
