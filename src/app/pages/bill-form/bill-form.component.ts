import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { BillItem, GstSummaryRow, PartyDetails, BankDetails } from '../../models/bill.model';
import { BillService } from '../../services/bill.service';

@Component({
  selector: 'app-bill-form',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './bill-form.component.html',
  styleUrl: './bill-form.component.scss'
})
export class BillFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private billService = inject(BillService);

  isEditMode = false;
  editId: string | null = null;

  billNumber = '';
  billDate = '';

  buyer: PartyDetails = { name: '', gstNo: '', pan: '', address: '', phone: '', bankName: '', accountNumber: '', ifscCode: '' };
  supplier: PartyDetails = { name: '', gstNo: '', pan: '', address: '', phone: '', bankName: '', accountNumber: '', ifscCode: '' };

  items: BillItem[] = [];
  bankDetails: BankDetails = { bankName: '', accountNumber: '', ifscCode: '' };

  readonly TOTAL_ROWS = 28;

  // Autocomplete
  showBuyerSuggestions = false;
  showSupplierSuggestions = false;
  allBuyers: PartyDetails[] = [];
  allSuppliers: PartyDetails[] = [];

  get buyerSuggestions(): PartyDetails[] {
    if (!this.buyer.name || this.buyer.name.length < 1) return [];
    const q = this.buyer.name.toLowerCase();
    return this.allBuyers.filter(b => b.name.toLowerCase().includes(q));
  }

  get supplierSuggestions(): PartyDetails[] {
    if (!this.supplier.name || this.supplier.name.length < 1) return [];
    const q = this.supplier.name.toLowerCase();
    return this.allSuppliers.filter(s => s.name.toLowerCase().includes(q));
  }

  onBuyerNameInput() {
    this.showBuyerSuggestions = this.buyerSuggestions.length > 0;
  }

  onSupplierNameInput() {
    this.showSupplierSuggestions = this.supplierSuggestions.length > 0;
  }

  selectBuyer(b: PartyDetails) {
    this.buyer = { ...b };
    this.showBuyerSuggestions = false;
  }

  selectSupplier(s: PartyDetails) {
    this.supplier = { ...s };
    // Auto-fill bank details from supplier
    this.bankDetails = {
      bankName: s.bankName || '',
      accountNumber: s.accountNumber || '',
      ifscCode: s.ifscCode || '',
    };
    this.showSupplierSuggestions = false;
  }

  hideBuyerSuggestions() {
    setTimeout(() => this.showBuyerSuggestions = false, 200);
  }

  hideSupplierSuggestions() {
    setTimeout(() => this.showSupplierSuggestions = false, 200);
  }

  ngOnInit() {
    // Load parties for autocomplete
    this.billService.getUniqueBuyers().subscribe(data => this.allBuyers = data);
    this.billService.getUniqueSuppliers().subscribe(data => this.allSuppliers = data);

    this.editId = this.route.snapshot.paramMap.get('id');
    this.isEditMode = !!this.editId;

    if (this.isEditMode && this.editId) {
      this.billService.getById(this.editId).subscribe({
        next: bill => {
          this.billNumber = bill.billNumber;
          this.billDate = bill.billDate;
          this.buyer = { ...bill.buyer };
          this.supplier = { ...bill.supplier };
          this.bankDetails = { ...bill.bankDetails };
          // Also sync from supplier if bank details exist there
          if (bill.supplier?.bankName) {
            this.bankDetails.bankName = bill.supplier.bankName;
            this.bankDetails.accountNumber = bill.supplier.accountNumber || '';
            this.bankDetails.ifscCode = bill.supplier.ifscCode || '';
          }

          this.items = [];
          for (let i = 0; i < this.TOTAL_ROWS; i++) {
            if (i < bill.items.length) {
              this.items.push({
                srNo: i + 1,
                description: bill.items[i].description,
                hsnSac: bill.items[i].hsnSac,
                unit: bill.items[i].unit || null,
                quantity: bill.items[i].quantity,
                rate: bill.items[i].rate,
                discount: bill.items[i].discount,
                cgstPercent: bill.items[i].cgstPercent,
                sgstPercent: bill.items[i].sgstPercent,
                amount: bill.items[i].amount,
              });
            } else {
              this.items.push(this.createEmptyItem(i + 1));
            }
          }
          this.items.forEach(item => {
            if (item.description && item.quantity && item.rate) this.calcAmount(item);
          });
        },
        error: () => {
          alert('Bill not found!');
          this.router.navigate(['/bills']);
        }
      });
    } else {
      this.billNumber = this.generateBillNumber();
      this.billDate = new Date().toISOString().split('T')[0];
      this.initEmptyItems();
    }
  }

  private createEmptyItem(srNo: number): BillItem {
    return {
      srNo, description: '', hsnSac: '', unit: null,
      quantity: null, rate: null, discount: null,
      cgstPercent: null, sgstPercent: null, amount: 0,
    };
  }

  private initEmptyItems() {
    this.items = Array.from({ length: this.TOTAL_ROWS }, (_, i) => this.createEmptyItem(i + 1));
  }

  generateBillNumber(): string {
    const d = new Date();
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    return `BILL-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(Math.floor(Math.random() * 9999), 4)}`;
  }

  calcAmount(item: BillItem) {
    const qty = item.quantity || 0;
    const rate = item.rate || 0;
    const disc = item.discount || 0;
    const base = qty * rate;
    const afterDisc = base - (base * disc) / 100;
    const cgst = (afterDisc * (item.cgstPercent || 0)) / 100;
    const sgst = (afterDisc * (item.sgstPercent || 0)) / 100;
    item.amount = +(afterDisc + cgst + sgst).toFixed(2);
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
  get filledItems(): BillItem[] {
    return this.items.filter(i => i.description && i.quantity && i.rate);
  }

  get totalTaxableAmount(): number {
    return +this.filledItems.reduce((s, i) => {
      const base = (i.quantity || 0) * (i.rate || 0);
      return s + base - (base * (i.discount || 0)) / 100;
    }, 0).toFixed(2);
  }

  get totalGst(): number {
    return +this.gstSummary.reduce((s, r) => s + r.totalTax, 0).toFixed(2);
  }

  get grandTotal(): number {
    return +(this.totalTaxableAmount + this.totalGst).toFixed(2);
  }

  get gstSummary(): GstSummaryRow[] {
    const map = new Map<string, GstSummaryRow>();
    this.filledItems.forEach(i => {
      const base = (i.quantity || 0) * (i.rate || 0);
      const taxable = +(base - (base * (i.discount || 0)) / 100).toFixed(2);
      const key = i.hsnSac || 'N/A';
      const cgstRate = i.cgstPercent || 0;
      const sgstRate = i.sgstPercent || 0;
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

  get totalItemsAmount(): number {
    return +this.filledItems.reduce((s, i) => s + i.amount, 0).toFixed(2);
  }

  get totalUnits(): number {
    return this.filledItems.reduce((s, i) => s + (i.unit || 0), 0);
  }

  saveBill() {
    if (!this.buyer.name || !this.supplier.name) {
      alert('Please fill in buyer and supplier names.');
      return;
    }
    if (this.filledItems.length === 0) {
      alert('Please add at least one item.');
      return;
    }

    const billData = {
      billNumber: this.billNumber,
      billDate: this.billDate,
      buyer: { ...this.buyer },
      supplier: { ...this.supplier, bankName: this.bankDetails.bankName, accountNumber: this.bankDetails.accountNumber, ifscCode: this.bankDetails.ifscCode },
      items: this.filledItems.map(i => ({ ...i })),
      bankDetails: { ...this.bankDetails },
      totalAmount: this.totalTaxableAmount,
      totalGst: this.totalGst,
      grandTotal: this.grandTotal,
    };

    const done = () => {
      alert(this.isEditMode ? 'Bill updated successfully!' : 'Bill saved successfully!');
      this.router.navigate(['/bills']);
    };

    if (this.isEditMode && this.editId) {
      this.billService.update(this.editId, billData as any).subscribe(done);
    } else {
      this.billService.create(billData as any).subscribe(done);
    }
  }
}
