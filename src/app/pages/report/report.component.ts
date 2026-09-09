import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BillService } from '../../services/bill.service';

@Component({
  selector: 'app-report',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './report.component.html',
  styleUrl: './report.component.scss'
})
export class ReportComponent implements OnInit {
  private svc = inject(BillService);

  // Existing Year / Month filters
  selectedYear = '';
  selectedMonth = '';

  // New filters
  selectedSupplier = '';
  fromDate = '';
  toDate = '';

  // Include / Exclude Proforma
  // Default = Exclude Proforma
  proformaFilter: 'include' | 'exclude' = 'exclude';

  availableYears: string[] = [];

  // Unique supplier/customer names for dropdown
  suppliers: string[] = [];

  months = [
    { value: '', label: 'All Months' },
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' }
  ];

  // Original data received from API
  private allSales: any[] = [];
  private allPurchases: any[] = [];

  // Filtered data displayed in report
  sales: any[] = [];
  purchases: any[] = [];
  monthlySummary: any[] = [];

  activeTab: 'summary' | 'sales' | 'purchases' = 'summary';

  ngOnInit(): void {
    this.loadReport();
  }

  /**
   * Load report from API.
   */
  loadReport(): void {
    this.svc
      .getReport(
        this.selectedYear || undefined,
        this.selectedMonth || undefined
      )
      .subscribe({
        next: (data) => {
          this.allSales = data.sales || [];
          this.allPurchases = data.purchases || [];

          if (!this.availableYears.length) {
            this.availableYears = data.availableYears || [];
          }

          // Build supplier dropdown from both sales and purchases
          this.buildSupplierList();

          // Apply current filters
          this.applyFilters();
        },

        error: (error) => {
          console.error('Failed to load report:', error);

          this.allSales = [];
          this.allPurchases = [];
          this.sales = [];
          this.purchases = [];
          this.monthlySummary = [];
          this.suppliers = [];
        }
      });
  }

  /**
   * Create unique supplier/customer list from
   * sales + purchases.
   *
   * The API currently provides the party name in:
   * invoice.name
   */
  private buildSupplierList(): void {
    const names = [
      ...this.allSales.map(item => item.name),
      ...this.allPurchases.map(item => item.name)
    ];

    this.suppliers = Array.from(
      new Set(
        names
          .map(name => String(name ?? '').trim())
          .filter(name => name.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Apply all report filters.
   */
  applyFilters(): void {
    this.sales = this.filterInvoices(this.allSales);
    this.purchases = this.filterInvoices(this.allPurchases);

    this.buildMonthlySummary();
  }

  /**
   * Apply supplier, proforma and date filters.
   */
  private filterInvoices(invoices: any[]): any[] {
    return invoices.filter((invoice) => {

      // =====================================================
      // SUPPLIER FILTER
      // =====================================================

      if (this.selectedSupplier) {
        const invoiceName = String(invoice.name ?? '')
          .trim()
          .toLowerCase();

        const selectedName = this.selectedSupplier
          .trim()
          .toLowerCase();

        if (invoiceName !== selectedName) {
          return false;
        }
      }

      // =====================================================
      // PROFORMA FILTER
      // =====================================================

      const invoiceNo = String(invoice.invoiceNo ?? '')
        .trim()
        .toLowerCase();

      /*
       * Your actual invoice example:
       *
       * PROFARMA-20260902-0213
       *
       * Therefore we check both:
       * - proforma
       * - profarma
       *
       * This makes the filter tolerant of either spelling.
       */
      const isProforma =
        invoiceNo.includes('proforma') ||
        invoiceNo.includes('profarma');

      if (
        this.proformaFilter === 'exclude' &&
        isProforma
      ) {
        return false;
      }

      // =====================================================
      // DATE FILTER
      // =====================================================

      const invoiceDate = String(
        invoice.invoiceDate ?? ''
      ).substring(0, 10);

      if (!invoiceDate) {
        return false;
      }

      if (
        this.fromDate &&
        invoiceDate < this.fromDate
      ) {
        return false;
      }

      if (
        this.toDate &&
        invoiceDate > this.toDate
      ) {
        return false;
      }

      return true;
    });
  }

  /**
   * Year / Month are existing API filters.
   *
   * When changed, reload the report from API.
   */
  onYearMonthChange(): void {
    this.loadReport();
  }

  /**
   * Apply button.
   */
  onApplyFilters(): void {
    if (
      this.fromDate &&
      this.toDate &&
      this.fromDate > this.toDate
    ) {
      alert('From Date cannot be greater than To Date.');
      return;
    }

    this.applyFilters();
  }

  /**
   * Clear all filters.
   */
  clearFilters(): void {
    this.selectedYear = '';
    this.selectedMonth = '';

    this.selectedSupplier = '';

    this.fromDate = '';
    this.toDate = '';

    // Default behavior = exclude proforma
    this.proformaFilter = 'exclude';

    this.loadReport();
  }

  /**
   * Build monthly summary from filtered data.
   */
  private buildMonthlySummary(): void {
    const summaryMap = new Map<string, any>();

    const createSummary = () => ({
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
    });

    // =====================================================
    // SALES
    // =====================================================

    this.sales.forEach((sale) => {
      const monthKey = this.getMonthKey(sale);

      if (!monthKey) {
        return;
      }

      if (!summaryMap.has(monthKey)) {
        summaryMap.set(
          monthKey,
          createSummary()
        );
      }

      const summary = summaryMap.get(monthKey);

      summary.sales.count++;

      summary.sales.cgst += Number(
        sale.cgst || 0
      );

      summary.sales.sgst += Number(
        sale.sgst || 0
      );

      summary.sales.totalWithTax += Number(
        sale.totalWithTax || 0
      );

      summary.sales.totalWithoutTax += Number(
        sale.totalWithoutTax || 0
      );
    });

    // =====================================================
    // PURCHASES
    // =====================================================

    this.purchases.forEach((purchase) => {
      const monthKey = this.getMonthKey(purchase);

      if (!monthKey) {
        return;
      }

      if (!summaryMap.has(monthKey)) {
        summaryMap.set(
          monthKey,
          createSummary()
        );
      }

      const summary = summaryMap.get(monthKey);

      summary.purchases.count++;

      summary.purchases.cgst += Number(
        purchase.cgst || 0
      );

      summary.purchases.sgst += Number(
        purchase.sgst || 0
      );

      summary.purchases.totalWithTax += Number(
        purchase.totalWithTax || 0
      );

      summary.purchases.totalWithoutTax += Number(
        purchase.totalWithoutTax || 0
      );
    });

    // =====================================================
    // CONVERT MAP TO ARRAY
    // =====================================================

    this.monthlySummary = Array.from(
      summaryMap.entries()
    )
      .map(([month, value]) => ({
        month,

        sales: {
          count: value.sales.count,
          cgst: this.round(value.sales.cgst),
          sgst: this.round(value.sales.sgst),
          totalWithTax: this.round(
            value.sales.totalWithTax
          ),
          totalWithoutTax: this.round(
            value.sales.totalWithoutTax
          )
        },

        purchases: {
          count: value.purchases.count,
          cgst: this.round(
            value.purchases.cgst
          ),
          sgst: this.round(
            value.purchases.sgst
          ),
          totalWithTax: this.round(
            value.purchases.totalWithTax
          ),
          totalWithoutTax: this.round(
            value.purchases.totalWithoutTax
          )
        }
      }))
      .sort((a, b) =>
        b.month.localeCompare(a.month)
      );
  }

  private getMonthKey(invoice: any): string {
    if (invoice.monthKey) {
      return String(invoice.monthKey);
    }

    if (invoice.invoiceDate) {
      return String(invoice.invoiceDate).substring(
        0,
        7
      );
    }

    return '';
  }

  private round(value: number): number {
    return Number(
      Number(value || 0).toFixed(2)
    );
  }

  // =====================================================
  // SALES TOTALS
  // =====================================================

  get salesTotals() {
    return {
      cgst: this.round(
        this.sales.reduce(
          (sum, row) =>
            sum + Number(row.cgst || 0),
          0
        )
      ),

      sgst: this.round(
        this.sales.reduce(
          (sum, row) =>
            sum + Number(row.sgst || 0),
          0
        )
      ),

      withTax: this.round(
        this.sales.reduce(
          (sum, row) =>
            sum + Number(
              row.totalWithTax || 0
            ),
          0
        )
      ),

      withoutTax: this.round(
        this.sales.reduce(
          (sum, row) =>
            sum + Number(
              row.totalWithoutTax || 0
            ),
          0
        )
      )
    };
  }

  // =====================================================
  // PURCHASE TOTALS
  // =====================================================

  get purchasesTotals() {
    return {
      cgst: this.round(
        this.purchases.reduce(
          (sum, row) =>
            sum + Number(row.cgst || 0),
          0
        )
      ),

      sgst: this.round(
        this.purchases.reduce(
          (sum, row) =>
            sum + Number(row.sgst || 0),
          0
        )
      ),

      withTax: this.round(
        this.purchases.reduce(
          (sum, row) =>
            sum + Number(
              row.totalWithTax || 0
            ),
          0
        )
      ),

      withoutTax: this.round(
        this.purchases.reduce(
          (sum, row) =>
            sum + Number(
              row.totalWithoutTax || 0
            ),
          0
        )
      )
    };
  }

  monthName(key: string): string {
    const [year, month] = key.split('-');

    const monthObj = this.months.find(
      m => m.value === month
    );

    return `${monthObj?.label || month} ${year}`;
  }

  /**
   * Text displayed in print header and Excel.
   */
  get filterLabel(): string {
    const filters: string[] = [];

    // Supplier
    if (this.selectedSupplier) {
      filters.push(
        `Supplier: ${this.selectedSupplier}`
      );
    } else {
      filters.push('All Suppliers');
    }

    // Proforma
    filters.push(
      this.proformaFilter === 'exclude'
        ? 'Proforma Excluded'
        : 'Proforma Included'
    );

    // Date
    if (this.fromDate || this.toDate) {
      filters.push(
        `Date: ${this.fromDate || 'Start'} to ${this.toDate || 'End'}`
      );
    }

    // Year / Month
    if (this.selectedYear || this.selectedMonth) {
      const month = this.months.find(
        m => m.value === this.selectedMonth
      );

      const monthLabel =
        month && month.value
          ? month.label
          : 'All Months';

      filters.push(
        `${this.selectedYear || 'All Years'} - ${monthLabel}`
      );
    }

    return filters.join(' | ');
  }

  printReport(): void {
    window.print();
  }

  downloadExcel(): void {
    const esc = (value: any) =>
      `"${String(value ?? '').replace(
        /"/g,
        '""'
      )}"`;

    let csv =
      `Report: ${this.filterLabel}\n\n`;

    // =====================================================
    // SUMMARY
    // =====================================================

    if (this.activeTab === 'summary') {
      csv +=
        'Month,Sales Count,Sales CGST,Sales SGST,Sales With Tax,Sales Without Tax,Purchase Count,Purchase CGST,Purchase SGST,Purchase With Tax,Purchase Without Tax\n';

      this.monthlySummary.forEach(m => {
        csv += [
          this.monthName(m.month),
          m.sales.count,
          m.sales.cgst,
          m.sales.sgst,
          m.sales.totalWithTax,
          m.sales.totalWithoutTax,
          m.purchases.count,
          m.purchases.cgst,
          m.purchases.sgst,
          m.purchases.totalWithTax,
          m.purchases.totalWithoutTax
        ]
          .map(esc)
          .join(',') + '\n';
      });
    }

    // =====================================================
    // SALES
    // =====================================================

    else if (this.activeTab === 'sales') {
      csv +=
        'Invoice No,Date,Name,GST No,CGST,SGST,With Tax,Without Tax\n';

      this.sales.forEach(s => {
        csv += [
          s.invoiceNo,
          s.invoiceDate,
          s.name,
          s.gstNo,
          s.cgst,
          s.sgst,
          s.totalWithTax,
          s.totalWithoutTax
        ]
          .map(esc)
          .join(',') + '\n';
      });

      csv += [
        'TOTAL',
        '',
        '',
        '',
        this.salesTotals.cgst,
        this.salesTotals.sgst,
        this.salesTotals.withTax,
        this.salesTotals.withoutTax
      ]
        .map(esc)
        .join(',') + '\n';
    }

    // =====================================================
    // PURCHASES
    // =====================================================

    else {
      csv +=
        'Invoice No,Date,Name,GST No,CGST,SGST,With Tax,Without Tax\n';

      this.purchases.forEach(p => {
        csv += [
          p.invoiceNo,
          p.invoiceDate,
          p.name,
          p.gstNo,
          p.cgst,
          p.sgst,
          p.totalWithTax,
          p.totalWithoutTax
        ]
          .map(esc)
          .join(',') + '\n';
      });

      csv += [
        'TOTAL',
        '',
        '',
        '',
        this.purchasesTotals.cgst,
        this.purchasesTotals.sgst,
        this.purchasesTotals.withTax,
        this.purchasesTotals.withoutTax
      ]
        .map(esc)
        .join(',') + '\n';
    }

    const blob = new Blob(
      [csv],
      {
        type: 'text/csv;charset=utf-8;'
      }
    );

    const url =
      URL.createObjectURL(blob);

    const a =
      document.createElement('a');

    a.href = url;

    a.download =
      `report-${this.activeTab}-${this.filterLabel
        .replace(/\s+/g, '-')
        .replace(/[|:]/g, '-')}.csv`;

    a.click();

    URL.revokeObjectURL(url);
  }
}
