import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { BillService } from '../../services/bill.service';

export interface PurchaseParty {
  name: string;
  gstNo: string;
}

export interface PurchasePayload {
  invoiceNo: string;
  invoiceDate: string;

  buyerName: string;
  buyerGstNo: string;

  supplierName: string;
  supplierGstNo: string;

  taxableAmount: number;

  cgstPercent: number;
  sgstPercent: number;
}

@Component({
  selector: 'app-purchase-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink
  ],
  templateUrl: './purchase-form.component.html',
  styleUrl: './purchase-form.component.scss'
})
export class PurchaseFormComponent implements OnInit {

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private svc = inject(BillService);

  // =========================================================
  // EDIT MODE
  // =========================================================

  isEdit = false;
  editId: string | null = null;

  // =========================================================
  // FORM STATE
  // =========================================================

  invoiceNo = '';
  invoiceDate = '';

  // =========================================================
  // BUYER
  // =========================================================

  buyerName = '';
  buyerGstNo = '';

  // =========================================================
  // SUPPLIER
  // =========================================================

  supplierName = '';
  supplierGstNo = '';

  // =========================================================
  // AMOUNTS
  // =========================================================

  taxableAmount = 0;

  cgstPercent = 9;
  sgstPercent = 9;

  cgstAmount = 0;
  sgstAmount = 0;

  // =========================================================
  // AUTOCOMPLETE
  // =========================================================

  allBuyers: PurchaseParty[] = [];
  allSuppliers: PurchaseParty[] = [];

  showBuyerSuggestions = false;
  showSupplierSuggestions = false;

  // =========================================================
  // UI STATE
  // =========================================================

  saving = false;
  loading = false;
  errorMessage = '';
  successMessage = '';

  // =========================================================
  // INIT
  // =========================================================

  ngOnInit(): void {

    this.editId = this.route.snapshot.paramMap.get('id');
    this.isEdit = !!this.editId;

    this.invoiceDate = this.getToday();

    this.loadBuyers();
    this.loadSuppliers();

    if (this.isEdit && this.editId) {
      this.loadPurchase(this.editId);
    }

    this.calculateTax();
  }

  // =========================================================
  // TODAY
  // =========================================================

  private getToday(): string {

    return new Date()
      .toISOString()
      .split('T')[0];
  }

  // =========================================================
  // LOAD BUYERS
  // =========================================================

  loadBuyers(): void {

    this.svc.getUniquePurchaseBuyers().subscribe({

      next: (data: any[]) => {

        this.allBuyers = (data || []).map(item => ({
          name: item.name || item.buyerName || '',
          gstNo: item.gstNo || item.buyerGstNo || ''
        }));

      },

      error: (error) => {

        console.error(
          'Error loading buyers:',
          error
        );

        this.allBuyers = [];
      }

    });
  }

  // =========================================================
  // LOAD SUPPLIERS
  // =========================================================

  loadSuppliers(): void {

    this.svc.getUniquePurchaseSuppliers().subscribe({

      next: (data: any[]) => {

        this.allSuppliers = (data || []).map(item => ({
          name: item.name || item.supplierName || '',
          gstNo: item.gstNo || item.supplierGstNo || ''
        }));

      },

      error: (error) => {

        console.error(
          'Error loading suppliers:',
          error
        );

        this.allSuppliers = [];
      }

    });
  }

  // =========================================================
  // BUYER SUGGESTIONS
  // =========================================================

  get buyerSuggestions(): PurchaseParty[] {

    const query = this.buyerName
      .trim()
      .toLowerCase();

    if (!query) {
      return [];
    }

    return this.allBuyers
      .filter(b =>
        b.name &&
        b.name.toLowerCase().includes(query)
      )
      .slice(0, 10);
  }

  // =========================================================
  // SUPPLIER SUGGESTIONS
  // =========================================================

  get supplierSuggestions(): PurchaseParty[] {

    const query = this.supplierName
      .trim()
      .toLowerCase();

    if (!query) {
      return [];
    }

    return this.allSuppliers
      .filter(s =>
        s.name &&
        s.name.toLowerCase().includes(query)
      )
      .slice(0, 10);
  }

  // =========================================================
  // BUYER INPUT
  // =========================================================

  onBuyerInput(): void {

    this.showBuyerSuggestions =
      this.buyerName.trim().length > 0;
  }

  // =========================================================
  // SUPPLIER INPUT
  // =========================================================

  onSupplierInput(): void {

    this.showSupplierSuggestions =
      this.supplierName.trim().length > 0;
  }

  // =========================================================
  // SELECT BUYER
  // =========================================================

  selectBuyer(buyer: PurchaseParty): void {

    this.buyerName = buyer.name || '';
    this.buyerGstNo = buyer.gstNo || '';

    this.showBuyerSuggestions = false;
  }

  // =========================================================
  // SELECT SUPPLIER
  // =========================================================

  selectSupplier(supplier: PurchaseParty): void {

    this.supplierName = supplier.name || '';
    this.supplierGstNo = supplier.gstNo || '';

    this.showSupplierSuggestions = false;
  }

  // =========================================================
  // HIDE BUYER SUGGESTIONS
  // =========================================================

  hideBuyerSuggestions(): void {

    setTimeout(() => {
      this.showBuyerSuggestions = false;
    }, 200);
  }

  // =========================================================
  // HIDE SUPPLIER SUGGESTIONS
  // =========================================================

  hideSupplierSuggestions(): void {

    setTimeout(() => {
      this.showSupplierSuggestions = false;
    }, 200);
  }

  // =========================================================
  // TAX CALCULATION
  // =========================================================

  calculateTax(): void {

    const taxable = Number(this.taxableAmount) || 0;
    const cgstRate = Number(this.cgstPercent) || 0;
    const sgstRate = Number(this.sgstPercent) || 0;

    this.cgstAmount = this.roundToTwo(
      taxable * cgstRate / 100
    );

    this.sgstAmount = this.roundToTwo(
      taxable * sgstRate / 100
    );
  }

  // =========================================================
  // TOTAL GST
  // =========================================================

  get totalTax(): number {

    return this.roundToTwo(
      this.cgstAmount + this.sgstAmount
    );
  }

  // =========================================================
  // GRAND TOTAL
  // =========================================================

  get grandTotal(): number {

    const taxable = Number(this.taxableAmount) || 0;

    return this.roundToTwo(
      taxable +
      this.cgstAmount +
      this.sgstAmount
    );
  }

  // =========================================================
  // ROUND
  // =========================================================

  private roundToTwo(value: number): number {

    return Math.round(
      (value + Number.EPSILON) * 100
    ) / 100;
  }

  // =========================================================
  // LOAD PURCHASE FOR EDIT
  // =========================================================

  private loadPurchase(id: string): void {

    this.loading = true;
    this.errorMessage = '';

    this.svc.getPurchaseById(id).subscribe({

      next: (p: any) => {

        this.invoiceNo = p.invoiceNo || '';
        this.invoiceDate = p.invoiceDate || '';

        // -----------------------------------------------------
        // BUYER
        // -----------------------------------------------------

        this.buyerName =
          p.buyerName ||
          p.buyer?.name ||
          '';

        this.buyerGstNo =
          p.buyerGstNo ||
          p.buyer?.gstNo ||
          '';

        // -----------------------------------------------------
        // SUPPLIER
        // -----------------------------------------------------

        this.supplierName =
          p.supplierName ||
          p.supplier?.name ||
          '';

        this.supplierGstNo =
          p.supplierGstNo ||
          p.supplier?.gstNo ||
          '';

        // -----------------------------------------------------
        // AMOUNTS
        // -----------------------------------------------------

        this.taxableAmount =
          Number(p.taxableAmount) || 0;

        this.cgstPercent =
          Number(p.cgstPercent) || 0;

        this.sgstPercent =
          Number(p.sgstPercent) || 0;

        this.calculateTax();

        this.loading = false;
      },

      error: (error) => {

        console.error(
          'Error loading purchase:',
          error
        );

        this.errorMessage =
          error?.error?.message ||
          error?.error?.error ||
          'Failed to load purchase.';

        this.loading = false;
      }

    });
  }

  // =========================================================
  // VALIDATION
  // =========================================================

  private validate(): boolean {

    this.errorMessage = '';

    if (!this.invoiceNo.trim()) {
      this.errorMessage =
        'Invoice number is required.';
      return false;
    }

    if (!this.invoiceDate) {
      this.errorMessage =
        'Invoice date is required.';
      return false;
    }

    if (!this.buyerName.trim()) {
      this.errorMessage =
        'Buyer name is required.';
      return false;
    }

    if (!this.supplierName.trim()) {
      this.errorMessage =
        'Supplier name is required.';
      return false;
    }

    if (
      !Number.isFinite(Number(this.taxableAmount)) ||
      Number(this.taxableAmount) < 0
    ) {
      this.errorMessage =
        'Taxable amount must be a valid positive number.';
      return false;
    }

    if (
      !Number.isFinite(Number(this.cgstPercent)) ||
      Number(this.cgstPercent) < 0
    ) {
      this.errorMessage =
        'CGST percentage is invalid.';
      return false;
    }

    if (
      !Number.isFinite(Number(this.sgstPercent)) ||
      Number(this.sgstPercent) < 0
    ) {
      this.errorMessage =
        'SGST percentage is invalid.';
      return false;
    }

    return true;
  }

  // =========================================================
  // CREATE PAYLOAD
  // =========================================================

  private buildPayload(): PurchasePayload {

    return {

      invoiceNo:
        this.invoiceNo.trim(),

      invoiceDate:
        this.invoiceDate,

      buyerName:
        this.buyerName.trim(),

      buyerGstNo:
        this.buyerGstNo.trim(),

      supplierName:
        this.supplierName.trim(),

      supplierGstNo:
        this.supplierGstNo.trim(),

      taxableAmount:
        Number(this.taxableAmount) || 0,

      cgstPercent:
        Number(this.cgstPercent) || 0,

      sgstPercent:
        Number(this.sgstPercent) || 0

    };
  }

  // =========================================================
  // SAVE
  // =========================================================

  save(): void {

    if (this.saving) {
      return;
    }

    if (!this.validate()) {
      return;
    }

    this.calculateTax();

    const payload = this.buildPayload();

    console.log(
      'Purchase payload:',
      payload
    );

    this.saving = true;
    this.errorMessage = '';
    this.successMessage = '';

    // =======================================================
    // UPDATE
    // =======================================================

    if (this.isEdit && this.editId) {

      this.svc.updatePurchase(
        this.editId,
        payload
      ).subscribe({

        next: (purchase) => {

          console.log(
            'Purchase updated:',
            purchase
          );

          this.saving = false;

          this.router.navigate([
            '/purchases'
          ]);
        },

        error: (error) => {

          console.error(
            'Error updating purchase:',
            error
          );

          this.saving = false;

          this.errorMessage =
            error?.error?.message ||
            error?.error?.error ||
            'Failed to update purchase.';
        }

      });

      return;
    }

    // =======================================================
    // CREATE
    // =======================================================

    this.svc.createPurchase(
      payload
    ).subscribe({

      next: (purchase) => {

        console.log(
          'Purchase created:',
          purchase
        );

        this.saving = false;

        this.router.navigate([
          '/purchases'
        ]);
      },

      error: (error) => {

        console.error(
          'Error creating purchase:',
          error
        );

        this.saving = false;

        this.errorMessage =
          error?.error?.message ||
          error?.error?.error ||
          'Failed to create purchase.';
      }

    });
  }

  // =========================================================
  // CANCEL
  // =========================================================

  cancel(): void {

    this.router.navigate([
      '/purchases'
    ]);
  }
}
