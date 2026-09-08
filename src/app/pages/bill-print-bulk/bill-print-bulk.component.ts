import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BillService } from '../../services/bill.service';
import { Bill, BillItem, GstSummaryRow } from '../../models/bill.model';

@Component({
  selector: 'app-bill-print-bulk',
  imports: [CommonModule],
  templateUrl: './bill-print-bulk.component.html',
  styleUrl: './bill-print-bulk.component.scss'
})
export class BillPrintBulkComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private billService = inject(BillService);

  bills: Bill[] = [];
  loading = true;

  ngOnInit() {
    const idsParam = this.route.snapshot.queryParamMap.get('ids') || '';
    const ids = idsParam.split(',').filter(id => id.trim());
    if (!ids.length) { this.loading = false; return; }

    forkJoin(ids.map(id => this.billService.getById(id))).subscribe({
      next: (bills) => {
        this.bills = bills;
        this.bills.forEach(b => b.items.forEach(i => this.calcAmount(i)));
        this.loading = false;
        setTimeout(() => window.print(), 500);
      },
      error: () => this.loading = false,
    });
  }

  private calcAmount(item: BillItem) {
    const qty = item.quantity || 0, rate = item.rate || 0, disc = item.discount || 0;
    const base = qty * rate;
    const afterDisc = base - (base * disc) / 100;
    item.amount = +(afterDisc + (afterDisc * (item.cgstPercent || 0)) / 100 + (afterDisc * (item.sgstPercent || 0)) / 100).toFixed(2);
  }

  filledItems(bill: Bill): BillItem[] {
    return bill.items.filter(i => i.description && i.quantity && i.rate);
  }

  emptyRows(bill: Bill): number[] {
    return Array(Math.max(0, 28 - this.filledItems(bill).length)).fill(0);
  }

  totalUnits(bill: Bill): number {
    return this.filledItems(bill).reduce((s, i) => s + (i.unit || 0), 0);
  }

  totalItemsAmount(bill: Bill): number {
    return +this.filledItems(bill).reduce((s, i) => s + i.amount, 0).toFixed(2);
  }

  totalTaxable(bill: Bill): number {
    return +this.filledItems(bill).reduce((s, i) => {
      const base = (i.quantity || 0) * (i.rate || 0);
      return s + base - (base * (i.discount || 0)) / 100;
    }, 0).toFixed(2);
  }

  gstSummary(bill: Bill): GstSummaryRow[] {
    const map = new Map<string, GstSummaryRow>();
    this.filledItems(bill).forEach(i => {
      const base = (i.quantity || 0) * (i.rate || 0);
      const taxable = +(base - (base * (i.discount || 0)) / 100).toFixed(2);
      const key = i.hsnSac || 'N/A';
      const cgstAmt = +(taxable * (i.cgstPercent || 0) / 100).toFixed(2);
      const sgstAmt = +(taxable * (i.sgstPercent || 0) / 100).toFixed(2);
      const existing = map.get(key);
      if (existing) {
        existing.taxableValue = +(existing.taxableValue + taxable).toFixed(2);
        existing.cgstAmount = +(existing.cgstAmount + cgstAmt).toFixed(2);
        existing.sgstAmount = +(existing.sgstAmount + sgstAmt).toFixed(2);
        existing.totalTax = +(existing.totalTax + cgstAmt + sgstAmt).toFixed(2);
      } else {
        map.set(key, { hsnSac: key, taxableValue: taxable, cgstRate: i.cgstPercent || 0, cgstAmount: cgstAmt, sgstRate: i.sgstPercent || 0, sgstAmount: sgstAmt, totalTax: +(cgstAmt + sgstAmt).toFixed(2) });
      }
    });
    return Array.from(map.values());
  }

  totalGst(bill: Bill): number {
    return +this.gstSummary(bill).reduce((s, r) => s + r.totalTax, 0).toFixed(2);
  }

  grandTotal(bill: Bill): number {
    return +(this.totalTaxable(bill) + this.totalGst(bill)).toFixed(2);
  }

  numberToWords(num: number): string {
    if (!num || num === 0) return 'Zero Rupees Only';
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const convert = (n: number): string => {
      if (n < 20) return ones[n];
      if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
      if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '');
      if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
      if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
      return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
    };
    const whole = Math.floor(num), paise = Math.round((num - whole) * 100);
    let result = convert(whole) + ' Rupees';
    if (paise > 0) result += ' and ' + convert(paise) + ' Paise';
    return result + ' Only';
  }
}
