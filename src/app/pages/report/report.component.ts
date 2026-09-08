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

  selectedYear = '';
  selectedMonth = '';
  availableYears: string[] = [];
  months = [
    { value: '', label: 'All Months' },
    { value: '01', label: 'January' }, { value: '02', label: 'February' }, { value: '03', label: 'March' },
    { value: '04', label: 'April' }, { value: '05', label: 'May' }, { value: '06', label: 'June' },
    { value: '07', label: 'July' }, { value: '08', label: 'August' }, { value: '09', label: 'September' },
    { value: '10', label: 'October' }, { value: '11', label: 'November' }, { value: '12', label: 'December' },
  ];

  sales: any[] = [];
  purchases: any[] = [];
  monthlySummary: any[] = [];
  activeTab: 'summary' | 'sales' | 'purchases' = 'summary';

  ngOnInit() { this.loadReport(); }

  loadReport() {
    this.svc.getReport(this.selectedYear || undefined, this.selectedMonth || undefined).subscribe(data => {
      this.sales = data.sales;
      this.purchases = data.purchases;
      this.monthlySummary = data.monthlySummary;
      if (!this.availableYears.length) this.availableYears = data.availableYears;
    });
  }

  onFilterChange() { this.loadReport(); }

  get salesTotals() {
    return {
      cgst: +this.sales.reduce((s, r) => s + (r.cgst || 0), 0).toFixed(2),
      sgst: +this.sales.reduce((s, r) => s + (r.sgst || 0), 0).toFixed(2),
      withTax: +this.sales.reduce((s, r) => s + (r.totalWithTax || 0), 0).toFixed(2),
      withoutTax: +this.sales.reduce((s, r) => s + (r.totalWithoutTax || 0), 0).toFixed(2),
    };
  }

  get purchasesTotals() {
    return {
      cgst: +this.purchases.reduce((s, r) => s + (r.cgst || 0), 0).toFixed(2),
      sgst: +this.purchases.reduce((s, r) => s + (r.sgst || 0), 0).toFixed(2),
      withTax: +this.purchases.reduce((s, r) => s + (r.totalWithTax || 0), 0).toFixed(2),
      withoutTax: +this.purchases.reduce((s, r) => s + (r.totalWithoutTax || 0), 0).toFixed(2),
    };
  }

  monthName(key: string): string {
    const [y, m] = key.split('-');
    const month = this.months.find(mo => mo.value === m);
    return `${month?.label || m} ${y}`;
  }

  get filterLabel(): string {
    const m = this.months.find(mo => mo.value === this.selectedMonth);
    const mLabel = m && m.value ? m.label : 'All Months';
    return `${this.selectedYear || 'All Years'} - ${mLabel}`;
  }

  printReport() {
    window.print();
  }

  downloadExcel() {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let csv = `Report: ${this.filterLabel}\n\n`;

    if (this.activeTab === 'summary') {
      csv += 'Month,Sales Count,Sales CGST,Sales SGST,Sales With Tax,Sales Without Tax,Purchase Count,Purchase CGST,Purchase SGST,Purchase With Tax,Purchase Without Tax\n';
      this.monthlySummary.forEach(m => {
        csv += [this.monthName(m.month), m.sales.count, m.sales.cgst, m.sales.sgst, m.sales.totalWithTax, m.sales.totalWithoutTax, m.purchases.count, m.purchases.cgst, m.purchases.sgst, m.purchases.totalWithTax, m.purchases.totalWithoutTax].map(esc).join(',') + '\n';
      });
    } else if (this.activeTab === 'sales') {
      csv += 'Invoice No,Date,Name,GST No,CGST,SGST,With Tax,Without Tax\n';
      this.sales.forEach(s => csv += [s.invoiceNo, s.invoiceDate, s.name, s.gstNo, s.cgst, s.sgst, s.totalWithTax, s.totalWithoutTax].map(esc).join(',') + '\n');
      csv += ['TOTAL','','','',this.salesTotals.cgst, this.salesTotals.sgst, this.salesTotals.withTax, this.salesTotals.withoutTax].map(esc).join(',') + '\n';
    } else {
      csv += 'Invoice No,Date,Name,GST No,CGST,SGST,With Tax,Without Tax\n';
      this.purchases.forEach(p => csv += [p.invoiceNo, p.invoiceDate, p.name, p.gstNo, p.cgst, p.sgst, p.totalWithTax, p.totalWithoutTax].map(esc).join(',') + '\n');
      csv += ['TOTAL','','','',this.purchasesTotals.cgst, this.purchasesTotals.sgst, this.purchasesTotals.withTax, this.purchasesTotals.withoutTax].map(esc).join(',') + '\n';
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${this.activeTab}-${this.filterLabel.replace(/\s/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
