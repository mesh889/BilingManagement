import { Component, OnInit, inject, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BillService } from '../../services/bill.service';
import { Bill, PartyDetails } from '../../models/bill.model';

@Component({
  selector: 'app-bill-list',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './bill-list.component.html',
  styleUrl: './bill-list.component.scss'
})
export class BillListComponent implements OnInit {
  private billService = inject(BillService);
  private el = inject(ElementRef);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {}

  bills: Bill[] = [];
  billSearch = '';
  buyerFilter = '';
  dateFrom = '';
  dateTo = '';

  // Supplier multi-select
  allSuppliers: PartyDetails[] = [];
  selectedSuppliers: Set<string> = new Set();
  showSupplierDropdown = false;

  // Pagination
  currentPage = 1;
  pageSize = 10;
  pageSizeOptions = [5, 10, 25, 50];

  // Bulk selection
  selectedBillIds: Set<string> = new Set();

  ngOnInit() {
    this.billService.getUniqueSuppliers().subscribe(data => {
      this.allSuppliers = data;
      this.loadBills();
    });
  }

  loadBills() {
    this.billService.getAll().subscribe(data => {
      this.bills = data.sort((a, b) => {
        const dateCompare = (b.billDate || '').localeCompare(a.billDate || '');
        return dateCompare !== 0 ? dateCompare : Number(b.id) - Number(a.id);
      });
      this.selectedBillIds.clear();
    });
  }

  // === Supplier dropdown ===
  openSupplierDropdown() { this.showSupplierDropdown = true; }
  closeSupplierDropdown() { this.showSupplierDropdown = false; }

  toggleSupplier(name: string) {
    if (this.selectedSuppliers.has(name)) this.selectedSuppliers.delete(name);
    else this.selectedSuppliers.add(name);
    this.currentPage = 1;
  }

  selectAllSuppliers() { this.allSuppliers.forEach(s => this.selectedSuppliers.add(s.name)); this.currentPage = 1; }
  clearSupplierSelection() { this.selectedSuppliers.clear(); this.currentPage = 1; }

  get supplierSelectionLabel(): string {
    if (this.selectedSuppliers.size === 0) return 'All Suppliers';
    if (this.selectedSuppliers.size === 1) return Array.from(this.selectedSuppliers)[0];
    return `${this.selectedSuppliers.size} suppliers selected`;
  }

  get filteredBills(): Bill[] {
    const search = this.billSearch.trim().toLowerCase();

    return this.bills.filter(b => {

      // Global bill search
      const matchSearch =
        !search ||
        [
          b.billNumber,
          b.billDate,
          b.buyer?.name,
          b.buyer?.gstNo,
          b.supplier?.name,
          b.supplier?.gstNo,

          // Search inside bill items
          ...(b.items || []).flatMap(i => [
            i.description,
            i.hsnSac,
            i.unit,
            i.quantity,
            i.rate,
            i.discount,
            i.cgstPercent,
            i.sgstPercent,
            i.amount
          ])
        ]
          .filter(v => v !== null && v !== undefined)
          .some(v =>
            String(v).toLowerCase().includes(search)
          );

      // Buyer filter
      const matchBuyer =
        !this.buyerFilter ||
        b.buyer.name
          .toLowerCase()
          .includes(this.buyerFilter.toLowerCase());

      // Supplier filter
      const matchSupplier =
        this.selectedSuppliers.size === 0 ||
        this.selectedSuppliers.has(b.supplier.name);

      // Date From
      const matchDateFrom =
        !this.dateFrom || b.billDate >= this.dateFrom;

      // Date To
      const matchDateTo =
        !this.dateTo || b.billDate <= this.dateTo;

      return (
        matchSearch &&
        matchBuyer &&
        matchSupplier &&
        matchDateFrom &&
        matchDateTo
      );
    });
  }


  // === Pagination ===
  get totalPages(): number { return Math.ceil(this.filteredBills.length / this.pageSize) || 1; }

  get paginatedBills(): Bill[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredBills.slice(start, start + this.pageSize);
  }

  get pages(): number[] {
    const pages: number[] = [];
    for (let i = Math.max(1, this.currentPage - 2); i <= Math.min(this.totalPages, this.currentPage + 2); i++) pages.push(i);
    return pages;
  }

  get startRecord(): number { return (this.currentPage - 1) * this.pageSize + 1; }
  get endRecord(): number { return Math.min(this.currentPage * this.pageSize, this.filteredBills.length); }

  goToPage(page: number) { if (page >= 1 && page <= this.totalPages) this.currentPage = page; }
  onPageSizeChange() { this.currentPage = 1; }
  onFilterChange() { this.currentPage = 1; }

  clearFilters() {
    this.billSearch = '';
    this.buyerFilter = '';
    this.selectedSuppliers.clear();
    this.dateFrom = '';
    this.dateTo = '';
    this.currentPage = 1;
  }



  get totalValue(): number { return this.filteredBills.reduce((sum, b) => sum + b.grandTotal, 0); }

  deleteBill(id: string | undefined) {
    if (!id) return;
    if (confirm('Are you sure you want to delete this bill?')) {
      this.billService.delete(id).subscribe(() => this.loadBills());
    }
  }

  // === Bulk Selection ===
  toggleBillSelection(id: string | undefined) {
    if (!id) return;
    if (this.selectedBillIds.has(id)) this.selectedBillIds.delete(id);
    else this.selectedBillIds.add(id);
  }

  get isAllPageSelected(): boolean {
    return this.paginatedBills.length > 0 && this.paginatedBills.every(b => this.selectedBillIds.has(b.id!));
  }

  toggleSelectAllPage() {
    if (this.isAllPageSelected) {
      this.paginatedBills.forEach(b => this.selectedBillIds.delete(b.id!));
    } else {
      this.paginatedBills.forEach(b => this.selectedBillIds.add(b.id!));
    }
  }

  selectAllFiltered() {
    this.filteredBills.forEach(b => this.selectedBillIds.add(b.id!));
  }

  clearSelection() {
    this.selectedBillIds.clear();
  }

  get selectedBills(): Bill[] {
    return this.filteredBills.filter(b => this.selectedBillIds.has(b.id!));
  }

  // === Export Excel (CSV) ===
  exportExcel() {
    const bills = this.selectedBills;
    if (!bills.length) return;

    const headers = ['Bill Number', 'Date', 'Buyer', 'Buyer GST', 'Supplier', 'Supplier GST', 'Items', 'Taxable Amount', 'Total GST', 'Grand Total'];
    const rows = bills.map(b => [
      b.billNumber, b.billDate, b.buyer.name, b.buyer.gstNo || '',
      b.supplier.name, b.supplier.gstNo || '', b.items.length,
      b.totalAmount, b.totalGst, b.grandTotal
    ]);

    // Items detail sheet
    const itemHeaders = ['Bill Number', 'Sr', 'Description', 'HSN/SAC', 'Unit', 'Qty', 'Rate', 'Discount%', 'CGST%', 'SGST%', 'Amount'];
    const itemRows: any[] = [];
    bills.forEach(b => {
      b.items.forEach(i => {
        itemRows.push([b.billNumber, i.srNo, i.description, i.hsnSac, i.unit, i.quantity, i.rate, i.discount, i.cgstPercent, i.sgstPercent, i.amount]);
      });
    });

    const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let csv = '=== BILLS SUMMARY ===\n';
    csv += headers.map(escape).join(',') + '\n';
    rows.forEach(r => csv += r.map(escape).join(',') + '\n');
    csv += '\n=== ITEM DETAILS ===\n';
    csv += itemHeaders.map(escape).join(',') + '\n';
    itemRows.forEach(r => csv += r.map(escape).join(',') + '\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bills-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // === Export PDF (print selected) ===
  exportPdf() {
    const ids = Array.from(this.selectedBillIds);
    if (!ids.length) return;
    // Open print view for multiple bills in new window
    const url = `/bills/print-bulk?ids=${ids.join(',')}`;
    window.open(url, '_blank');
  }
}
