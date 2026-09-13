import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BillService } from '../../services/bill.service';
import { Bill, BillItem, GstSummaryRow } from '../../models/bill.model';

@Component({
  selector: 'app-bill-view',
  imports: [CommonModule, RouterLink],
  templateUrl: './bill-view.component.html',
  styleUrl: './bill-view.component.scss'
})
export class BillViewComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private billService = inject(BillService);

  bill!: Bill;
  emptyRows: number[] = [];

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.router.navigate(['/bills']); return; }
    this.billService.getById(id).subscribe({
      next: bill => {
        this.bill = bill;
        this.bill.items.forEach(i => this.calcAmount(i));
        this.emptyRows = Array(Math.max(0, 28 - this.filledItems.length)).fill(0);
      },
      error: () => {
        alert('Bill not found!');
        this.router.navigate(['/bills']);
      }
    });
  }

  private calcAmount(item: BillItem) {
    const qty = item.quantity || 0;
    const rate = item.rate || 0;
    const disc = item.discount || 0;
    const base = qty * rate;
    const afterDisc = base - (base * disc) / 100;
    item.amount = +(afterDisc + (afterDisc * (item.cgstPercent || 0)) / 100 + (afterDisc * (item.sgstPercent || 0)) / 100).toFixed(2);
  }

  get filledItems(): BillItem[] {
    return this.bill.items.filter(i => i.description && i.quantity && i.rate);
  }

  get totalTaxableAmount(): number {
    return +this.filledItems.reduce((s, i) => {
      const base = (i.quantity || 0) * (i.rate || 0);
      return s + base - (base * (i.discount || 0)) / 100;
    }, 0).toFixed(2);
  }

  get gstSummary(): GstSummaryRow[] {
    const map = new Map<string, GstSummaryRow>();
    this.filledItems.forEach(i => {
      const base = (i.quantity || 0) * (i.rate || 0);
      const taxable = +(base - (base * (i.discount || 0)) / 100).toFixed(2);
      const key = i.hsnSac || 'N/A';
      const cgstRate = i.cgstPercent || 0, sgstRate = i.sgstPercent || 0;
      const cgstAmt = +(taxable * cgstRate / 100).toFixed(2);
      const sgstAmt = +(taxable * sgstRate / 100).toFixed(2);
      const existing = map.get(key);
      if (existing) {
        existing.taxableValue = +(existing.taxableValue + taxable).toFixed(2);
        existing.cgstAmount = +(existing.cgstAmount + cgstAmt).toFixed(2);
        existing.sgstAmount = +(existing.sgstAmount + sgstAmt).toFixed(2);
        existing.totalTax = +(existing.totalTax + cgstAmt + sgstAmt).toFixed(2);
      } else {
        map.set(key, { hsnSac: key, taxableValue: taxable, cgstRate, cgstAmount: cgstAmt, sgstRate, sgstAmount: sgstAmt, totalTax: +(cgstAmt + sgstAmt).toFixed(2) });
      }
    });
    return Array.from(map.values());
  }

  get totalGst(): number {
    return +this.gstSummary.reduce((s, r) => s + r.totalTax, 0).toFixed(2);
  }

  get grandTotal(): number {
    return +(this.totalTaxableAmount + this.totalGst).toFixed(2);
  }

  get totalItemsAmount(): number {
    return +this.filledItems.reduce((s, i) => s + i.amount, 0).toFixed(2);
  }

  get totalQuantity(): number {
    return this.filledItems.reduce((s, i) => s + (i.quantity || 0), 0);
  }

  get totalUnits(): number {
    return this.filledItems.reduce((s, i) => s + (i.quantity || 0), 0);
  }

  get gstInWords(): string { return this.numberToWords(this.totalGst); }
  get grandTotalInWords(): string { return this.numberToWords(this.grandTotal); }

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
    const whole = Math.floor(num);
    const paise = Math.round((num - whole) * 100);
    let result = convert(whole) + ' Rupees';
    if (paise > 0) result += ' and ' + convert(paise) + ' Paise';
    return result + ' Only';
  }

  printBill() {
    window.print();
  }
  getItemTaxableAmount(item: BillItem): number {
  const qty = item.quantity || 0;
  const rate = item.rate || 0;
  const discount = item.discount || 0;

  const base = qty * rate;

  const taxableAmount =
    base - (base * discount) / 100;

  return +taxableAmount.toFixed(2);
}
}
