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


  // ============================================================
  // FILTERS
  // ============================================================

  selectedYear = '';
  selectedMonth = '';

  selectedSupplier = '';

  fromDate = '';
  toDate = '';

  /*
   * TRUE = exclude matching invoices
   * FALSE = include matching invoices
   */
  excludeProforma = true;
  excludeQuotation = true;


  // ============================================================
  // DROPDOWN DATA
  // ============================================================

  availableYears: string[] = [];

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


  // ============================================================
  // REPORT DATA
  // ============================================================

  sales: any[] = [];
  purchases: any[] = [];

  monthlySummary: any[] = [];


  // Keep original filtered API result if required later
  allSales: any[] = [];
  allPurchases: any[] = [];


  // ============================================================
  // UI
  // ============================================================

  activeTab:
    | 'summary'
    | 'sales'
    | 'purchases' = 'summary';

  loading = false;


  // ============================================================
  // INIT
  // ============================================================

  ngOnInit(): void {
    this.loadReport();
  }


  // ============================================================
  // LOAD REPORT
  // ============================================================

  loadReport(): void {

    this.loading = true;

    this.svc.getReport(
      this.selectedYear || undefined,
      this.selectedMonth || undefined,
      this.selectedSupplier || undefined,
      this.fromDate || undefined,
      this.toDate || undefined,
      this.excludeProforma,
      this.excludeQuotation
    ).subscribe({

      next: (data) => {

        this.allSales = data.sales || [];
        this.allPurchases = data.purchases || [];

        this.sales = this.allSales;
        this.purchases = this.allPurchases;

        this.monthlySummary =
          data.monthlySummary || [];


        /*
         * Supplier dropdown
         */

        this.suppliers =
          data.suppliers || [];


        /*
         * Available years
         */

        this.availableYears =
          data.availableYears || [];


        this.loading = false;
      },

      error: (error) => {

        console.error(
          'Failed to load report:',
          error
        );

        this.sales = [];
        this.purchases = [];
        this.monthlySummary = [];

        this.loading = false;
      }

    });

  }


  // ============================================================
  // APPLY FILTER
  // ============================================================

  onApplyFilters(): void {

    /*
     * Validate date range
     */

    if (
      this.fromDate &&
      this.toDate &&
      this.fromDate > this.toDate
    ) {

      alert(
        'From Date cannot be greater than To Date.'
      );

      return;
    }


    this.loadReport();
  }


  // ============================================================
  // CLEAR FILTERS
  // ============================================================

  clearFilters(): void {

    this.selectedYear = '';
    this.selectedMonth = '';

    this.selectedSupplier = '';

    this.fromDate = '';
    this.toDate = '';

    /*
     * Default:
     *
     * Exclude Proforma
     * Exclude Quotation
     */

    this.excludeProforma = true;
    this.excludeQuotation = true;

    this.loadReport();
  }


  // ============================================================
  // FILTER LABEL
  // ============================================================

  get filterLabel(): string {

    const parts: string[] = [];


    /*
     * Supplier
     */

    if (this.selectedSupplier) {

      parts.push(
        `Supplier: ${this.selectedSupplier}`
      );

    } else {

      parts.push('All Suppliers');

    }


    /*
     * Date
     */

    if (this.fromDate || this.toDate) {

      const from =
        this.fromDate || 'Start';

      const to =
        this.toDate || 'Today';

      parts.push(
        `${from} to ${to}`
      );

    } else {

      /*
       * Year / Month
       */

      const month =
        this.months.find(
          m => m.value === this.selectedMonth
        );

      const monthLabel =
        month && month.value
          ? month.label
          : 'All Months';

      parts.push(
        `${this.selectedYear || 'All Years'} - ${monthLabel}`
      );

    }


    /*
     * Proforma status
     */

    parts.push(
      this.excludeProforma
        ? 'Proforma Excluded'
        : 'Proforma Included'
    );


    /*
     * Quotation status
     */

    parts.push(
      this.excludeQuotation
        ? 'Quotation Excluded'
        : 'Quotation Included'
    );


    return parts.join(' | ');
  }


  // ============================================================
  // SALES TOTALS
  // ============================================================

  get salesTotals() {

    return {

      cgst:
        +this.sales
          .reduce(
            (sum, row) =>
              sum + Number(row.cgst || 0),
            0
          )
          .toFixed(2),

      sgst:
        +this.sales
          .reduce(
            (sum, row) =>
              sum + Number(row.sgst || 0),
            0
          )
          .toFixed(2),

      withTax:
        +this.sales
          .reduce(
            (sum, row) =>
              sum + Number(row.totalWithTax || 0),
            0
          )
          .toFixed(2),

      withoutTax:
        +this.sales
          .reduce(
            (sum, row) =>
              sum + Number(row.totalWithoutTax || 0),
            0
          )
          .toFixed(2)

    };

  }


  // ============================================================
  // PURCHASE TOTALS
  // ============================================================

  get purchasesTotals() {

    return {

      cgst:
        +this.purchases
          .reduce(
            (sum, row) =>
              sum + Number(row.cgst || 0),
            0
          )
          .toFixed(2),

      sgst:
        +this.purchases
          .reduce(
            (sum, row) =>
              sum + Number(row.sgst || 0),
            0
          )
          .toFixed(2),

      withTax:
        +this.purchases
          .reduce(
            (sum, row) =>
              sum + Number(row.totalWithTax || 0),
            0
          )
          .toFixed(2),

      withoutTax:
        +this.purchases
          .reduce(
            (sum, row) =>
              sum + Number(row.totalWithoutTax || 0),
            0
          )
          .toFixed(2)

    };

  }


  // ============================================================
  // MONTH NAME
  // ============================================================

  monthName(key: string): string {

    const [year, month] =
      key.split('-');

    const monthData =
      this.months.find(
        m => m.value === month
      );

    return `${
      monthData?.label || month
    } ${year}`;
  }


  // ============================================================
  // PRINT
  // ============================================================

  printReport(): void {
    window.print();
  }


  // ============================================================
  // EXCEL / CSV
  // ============================================================

  downloadExcel(): void {

    const esc = (value: any) => {

      return `"${String(
        value ?? ''
      ).replace(/"/g, '""')}"`;

    };


    let csv =
      `Report: ${this.filterLabel}\n\n`;


    // ==========================================================
    // SUMMARY
    // ==========================================================

    if (this.activeTab === 'summary') {

      csv +=
        'Month,Sales Count,Sales CGST,Sales SGST,Sales With Tax,Sales Without Tax,Purchase Count,Purchase CGST,Purchase SGST,Purchase With Tax,Purchase Without Tax\n';


      this.monthlySummary.forEach(m => {

        csv += [

          this.monthName(m.month),

          m.sales?.count || 0,
          m.sales?.cgst || 0,
          m.sales?.sgst || 0,
          m.sales?.totalWithTax || 0,
          m.sales?.totalWithoutTax || 0,

          m.purchases?.count || 0,
          m.purchases?.cgst || 0,
          m.purchases?.sgst || 0,
          m.purchases?.totalWithTax || 0,
          m.purchases?.totalWithoutTax || 0

        ]
          .map(esc)
          .join(',') + '\n';

      });

    }


    // ==========================================================
    // SALES
    // ==========================================================

    else if (this.activeTab === 'sales') {

      csv +=
        'Invoice No,Date,Supplier Name,Supplier GST No,Buyer Name,Buyer GST No,CGST,SGST,With Tax,Without Tax\n';


      this.sales.forEach(s => {

        csv += [

          s.invoiceNo,
          s.invoiceDate,

          s.name,
          s.gstNo,

          s.buyerName || '',
          s.buyerGstNo || '',

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


    // ==========================================================
    // PURCHASES
    // ==========================================================

    else {

      csv +=
        'Invoice No,Date,Supplier Name,GST No,CGST,SGST,With Tax,Without Tax\n';


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


    // ==========================================================
    // DOWNLOAD
    // ==========================================================

    const blob =
      new Blob(
        [csv],
        {
          type:
            'text/csv;charset=utf-8;'
        }
      );


    const url =
      URL.createObjectURL(blob);


    const a =
      document.createElement('a');


    a.href = url;


    const safeLabel =
      this.filterLabel
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        .replace(/-+/g, '-');


    a.download =
      `report-${this.activeTab}-${safeLabel}.csv`;


    document.body.appendChild(a);

    a.click();

    document.body.removeChild(a);

    URL.revokeObjectURL(url);

  }

}