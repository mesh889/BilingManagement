import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BillService } from '../../services/bill.service';

@Component({
selector: 'app-purchase-list',
imports: [
CommonModule,
FormsModule,
RouterLink
],
templateUrl: './purchase-list.component.html',
styleUrl: './purchase-list.component.scss'
})
export class PurchaseListComponent implements OnInit {

private svc = inject(BillService);

// ==========================================
// DATA
// ==========================================

purchases: any[] = [];
filteredPurchases: any[] = [];

// ==========================================
// FILTERS
// ==========================================

selectedYear = '';
selectedBuyer = '';
selectedSupplier = '';
searchText = '';

// ==========================================
// FILTER OPTIONS
// ==========================================

years: string[] = [];
buyers: string[] = [];
suppliers: string[] = [];

// ==========================================
// TOTALS
// ==========================================

filteredTaxableTotal = 0;
filteredCgstTotal = 0;
filteredSgstTotal = 0;
filteredGstTotal = 0;
filteredGrandTotal = 0;

// ==========================================
// INIT
// ==========================================

ngOnInit(): void {
this.load();
}

// ==========================================
// LOAD PURCHASES
// ==========================================

load(): void {

this.svc.getPurchases().subscribe({

  next: (data: any[]) => {

    this.purchases = data || [];

    this.buildFilterOptions();

    this.applyFilters();
  },

  error: (err) => {

    console.error(
      'Failed to load purchases:',
      err
    );

    this.purchases = [];
    this.filteredPurchases = [];

    this.years = [];
    this.buyers = [];
    this.suppliers = [];

    this.calculateTotals();
  }

});


}

// ==========================================
// BUILD FILTER OPTIONS
// ==========================================

buildFilterOptions(): void {

// ------------------------------------------
// YEARS
// ------------------------------------------

this.years = [
  ...new Set(
    this.purchases
      .map(p =>
        String(p.invoiceDate || '')
          .substring(0, 4)
      )
      .filter(y => y)
  )
].sort((a, b) =>
  b.localeCompare(a)
);


// ------------------------------------------
// BUYERS
// ------------------------------------------

this.buyers = [
  ...new Set(
    this.purchases
      .map(p =>
        String(p.buyerName || '').trim()
      )
      .filter(name => name)
  )
].sort((a, b) =>
  a.localeCompare(b)
);


// ------------------------------------------
// SUPPLIERS
// ------------------------------------------

this.suppliers = [
  ...new Set(
    this.purchases
      .map(p =>
        String(p.supplierName || '').trim()
      )
      .filter(name => name)
  )
].sort((a, b) =>
  a.localeCompare(b)
);


}

// ==========================================
// APPLY FILTERS
// ==========================================

applyFilters(): void {

const search =
  this.searchText
    .trim()
    .toLowerCase();


this.filteredPurchases =
  this.purchases.filter((p: any) => {

    // --------------------------------------
    // YEAR
    // --------------------------------------

    const invoiceYear =
      String(p.invoiceDate || '')
        .substring(0, 4);

    const matchesYear =
      !this.selectedYear ||
      invoiceYear === this.selectedYear;


    // --------------------------------------
    // BUYER
    // --------------------------------------

    const buyerName =
      String(p.buyerName || '')
        .trim();

    const matchesBuyer =
      !this.selectedBuyer ||
      buyerName === this.selectedBuyer;


    // --------------------------------------
    // SUPPLIER
    // --------------------------------------

    const supplierName =
      String(p.supplierName || '')
        .trim();

    const matchesSupplier =
      !this.selectedSupplier ||
      supplierName === this.selectedSupplier;


    // --------------------------------------
    // GLOBAL SEARCH
    // --------------------------------------

    const invoiceNo =
      String(p.invoiceNo || '')
        .toLowerCase();

    const buyer =
      String(p.buyerName || '')
        .toLowerCase();

    const buyerGst =
      String(p.buyerGstNo || '')
        .toLowerCase();

    const supplier =
      String(p.supplierName || '')
        .toLowerCase();

    const supplierGst =
      String(p.supplierGstNo || '')
        .toLowerCase();

    const invoiceDate =
      String(p.invoiceDate || '')
        .toLowerCase();


    const matchesSearch =
      !search ||
      invoiceNo.includes(search) ||
      buyer.includes(search) ||
      buyerGst.includes(search) ||
      supplier.includes(search) ||
      supplierGst.includes(search) ||
      invoiceDate.includes(search);


    // --------------------------------------
    // FINAL
    // --------------------------------------

    return (
      matchesYear &&
      matchesBuyer &&
      matchesSupplier &&
      matchesSearch
    );

  });


this.calculateTotals();


}

// ==========================================
// CALCULATE TOTALS
// ==========================================

calculateTotals(): void {

this.filteredTaxableTotal =
  this.filteredPurchases.reduce(
    (total: number, p: any) => {

      return total +
        Number(p.taxableAmount || 0);

    },
    0
  );


this.filteredCgstTotal =
  this.filteredPurchases.reduce(
    (total: number, p: any) => {

      return total +
        Number(p.cgstAmount || 0);

    },
    0
  );


this.filteredSgstTotal =
  this.filteredPurchases.reduce(
    (total: number, p: any) => {

      return total +
        Number(p.sgstAmount || 0);

    },
    0
  );


this.filteredGstTotal =
  this.filteredCgstTotal +
  this.filteredSgstTotal;


this.filteredGrandTotal =
  this.filteredPurchases.reduce(
    (total: number, p: any) => {

      return total +
        Number(p.grandTotal || 0);

    },
    0
  );


}

// ==========================================
// CLEAR FILTERS
// ==========================================

clearFilters(): void {

this.selectedYear = '';
this.selectedBuyer = '';
this.selectedSupplier = '';
this.searchText = '';

this.applyFilters();


}

// ==========================================
// DELETE
// ==========================================

delete(id: number): void {

if (
  !confirm(
    'Are you sure you want to delete this purchase?'
  )
) {
  return;
}

this.svc
  .deletePurchase(String(id))
  .subscribe({

    next: () => {

      this.load();

    },

    error: (err) => {

      console.error(
        'Failed to delete purchase:',
        err
      );

      alert(
        'Failed to delete purchase.'
      );

    }

  });


}

}