import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TenantRentApiService } from '../services/tenant-rent-api.service';
import { Entry, EntryType, Property } from '../models/tenant-rent.models';

@Component({
  selector: 'app-transaction-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './transaction-list.component.html',
  styleUrl: './transaction-list.component.scss'
})
export class TransactionListComponent implements OnInit {
  private api = inject(TenantRentApiService);

  entries: Entry[] = [];
  properties: Property[] = [];

  entryType = '';
  propertyId = '';
  fromDate = '';
  toDate = '';
  status = 'POSTED';

  loading = false;
  errorMessage = '';

  readonly entryTypes: Array<{ value: EntryType | '', label: string }> = [
    { value: '', label: 'All Types' },
    { value: 'COLLECTION', label: 'Collection' },
    { value: 'EXPENSE', label: 'Expense' }
  ];

  ngOnInit(): void {
    this.loadProperties();
    this.loadEntries();
  }

  loadProperties(): void {
    this.api.getProperties().subscribe({
      next: response => this.properties = response.data || [],
      error: () => this.properties = []
    });
  }

  loadEntries(): void {
    this.loading = true;
    this.errorMessage = '';

    this.api.getEntries({
      status: this.status || undefined,
      entryType: this.entryType || undefined,
      propertyId: this.propertyId ? Number(this.propertyId) : undefined,
      fromDate: this.fromDate || undefined,
      toDate: this.toDate || undefined
    }).subscribe({
      next: response => {
        this.entries = response.data || [];
        this.loading = false;
      },
      error: error => {
        this.loading = false;
        this.errorMessage = error?.error?.message || 'Unable to load transactions.';
      }
    });
  }

  clearFilters(): void {
    this.entryType = '';
    this.propertyId = '';
    this.fromDate = '';
    this.toDate = '';
    this.status = 'POSTED';
    this.loadEntries();
  }

  voidEntry(entry: Entry): void {
    if (!confirm(`Void transaction ${entry.transaction_id}?`)) return;

    this.api.voidEntry(entry.id).subscribe({
      next: () => this.loadEntries(),
      error: error => {
        this.errorMessage = error?.error?.message || 'Unable to void transaction.';
      }
    });
  }

  money(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR'
    }).format(value || 0);
  }
}
