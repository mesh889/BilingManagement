import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TenantRentApiService } from '../services/tenant-rent-api.service';
import {
  Entry,
  EntryPayload,
  Masters,
  PropertyTenantOption
} from '../models/tenant-rent.models';

@Component({
  selector: 'app-transaction-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './transaction-form.component.html',
  styleUrl: './transaction-form.component.scss'
})
export class TransactionFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(TenantRentApiService);

  isEditMode = false;
  editId: number | null = null;

  masters: Masters | null = null;
  propertyTenants: PropertyTenantOption[] = [];

  model: EntryPayload = {
    entry_date: this.today(),

    // Rent period is used only for COLLECTION
    period_from: this.firstDayOfMonth(),
    period_to: this.lastDayOfMonth(),

    entry_type: 'COLLECTION',
    property_id: 0,
    tenant_id: null,
    category: 'RENT_COLLECTION',
    amount: 0,
    payment_mode: 'UPI',
    reference_no: '',
    notes: ''
  };

  existingTransactionId = '';
  loading = false;
  saving = false;
  errorMessage = '';

  get categories(): string[] {
    if (!this.masters) return [];

    return this.model.entry_type === 'COLLECTION'
      ? this.masters.collection_categories
      : this.masters.expense_categories;
  }

  /**
   * Number of complete rent months covered by the selected period.
   *
   * Example:
   * 01-Nov-2026 to 30-Nov-2026 = 1
   * 01-Nov-2026 to 31-Dec-2026 = 2
   * 01-Nov-2026 to 31-Jan-2027 = 3
   */
  get monthsCovered(): number {
    if (
      this.model.entry_type !== 'COLLECTION' ||
      !this.model.period_from ||
      !this.model.period_to
    ) {
      return 0;
    }

    const [fromYear, fromMonth] = this.model.period_from
      .slice(0, 7)
      .split('-')
      .map(Number);

    const [toYear, toMonth] = this.model.period_to
      .slice(0, 7)
      .split('-')
      .map(Number);

    const months =
      (toYear - fromYear) * 12 +
      (toMonth - fromMonth) +
      1;

    return months > 0 ? months : 0;
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');

    if (id) {
      this.isEditMode = true;
      this.editId = Number(id);
    }

    this.loadMasters();
  }

  today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Returns the first day of the month containing dateValue.
   */
  firstDayOfMonth(dateValue: string = this.today()): string {
    const [year, month] = dateValue.slice(0, 7).split('-').map(Number);

    return `${year}-${String(month).padStart(2, '0')}-01`;
  }

  /**
   * Returns the last day of the month containing dateValue.
   */
  lastDayOfMonth(dateValue: string = this.today()): string {
    const [year, month] = dateValue.slice(0, 7).split('-').map(Number);

    // month is 1-12.
    // Date.UTC(year, month, 0) gives the last day of that month.
    return new Date(Date.UTC(year, month, 0))
      .toISOString()
      .slice(0, 10);
  }

  /**
   * Rent Period From:
   * Always normalize it to the first day of its selected month.
   *
   * IMPORTANT:
   * Payment Date is NOT changed here.
   *
   * If the existing Rent Period To becomes earlier than From,
   * move To to the last day of the new From month.
   *
   * Otherwise keep To so the user can have multiple months.
   */
  onPeriodFromChange(): void {
    if (
      this.model.entry_type !== 'COLLECTION' ||
      !this.model.period_from
    ) {
      return;
    }

    const newFrom = this.firstDayOfMonth(this.model.period_from);

    this.model.period_from = newFrom;

    if (
      !this.model.period_to ||
      this.model.period_to < newFrom
    ) {
      this.model.period_to = this.lastDayOfMonth(newFrom);
    }
  }

  /**
   * Rent Period To:
   * Always normalize it to the last day of the selected ending month.
   *
   * Payment Date remains completely independent.
   */
  onPeriodToChange(): void {
    if (
      this.model.entry_type !== 'COLLECTION' ||
      !this.model.period_to
    ) {
      return;
    }

    const newTo = this.lastDayOfMonth(this.model.period_to);

    this.model.period_to = newTo;

    // Do not allow ending month before starting month.
    if (
      this.model.period_from &&
      newTo < this.model.period_from
    ) {
      this.errorMessage =
        'Rent Period To cannot be before Rent Period From.';

      this.model.period_to =
        this.lastDayOfMonth(this.model.period_from);

      return;
    }

    this.errorMessage = '';
  }

  /**
   * Set one-month default rent period.
   */
  setDefaultRentPeriod(): void {
    const from = this.firstDayOfMonth(
      this.model.period_from || this.today()
    );

    this.model.period_from = from;
    this.model.period_to = this.lastDayOfMonth(from);
  }

  loadMasters(): void {
    this.loading = true;

    this.api.getMasters().subscribe({
      next: response => {
        const data = response.data as any;

        this.masters = {
          types: data.entryTypes || data.types || [],

          collection_categories:
            data.categories?.COLLECTION ||
            data.collection_categories ||
            [],

          expense_categories:
            data.categories?.EXPENSE ||
            data.expense_categories ||
            [],

          payment_modes:
            data.paymentModes ||
            data.payment_modes ||
            [],

          properties: data.properties || [],
          tenants: data.tenants || []
        };

        this.loading = false;

        if (!this.isEditMode) {
          this.resetCategory();
        } else if (this.editId) {
          this.loadEntry(this.editId);
        }
      },

      error: error => {
        this.loading = false;

        this.errorMessage =
          error?.error?.message ||
          'Unable to load dropdown data.';
      }
    });
  }

  loadEntry(id: number): void {
    this.loading = true;

    this.api.getEntry(id).subscribe({
      next: response => {
        const entry: Entry = response.data;

        this.existingTransactionId =
          entry.transaction_id;

        this.model = {
          entry_date: entry.entry_date,

          period_from:
            entry.period_from ??
            (
              entry.entry_type === 'COLLECTION'
                ? this.firstDayOfMonth(entry.entry_date)
                : null
            ),

          period_to:
            entry.period_to ??
            (
              entry.entry_type === 'COLLECTION'
                ? this.lastDayOfMonth(entry.entry_date)
                : null
            ),

          entry_type: entry.entry_type,
          property_id: entry.property_id,
          tenant_id: entry.tenant_id ?? null,
          category: entry.category,
          amount: entry.amount,
          payment_mode: entry.payment_mode ?? 'UPI',
          reference_no: entry.reference_no ?? '',
          notes: entry.notes ?? '',
          status: entry.status
        };

        /*
         * Normalize old/saved collection periods.
         *
         * From = first day of its month
         * To   = last day of its ending month
         */
        if (this.model.entry_type === 'COLLECTION') {
          if (this.model.period_from) {
            this.model.period_from =
              this.firstDayOfMonth(this.model.period_from);
          }

          if (this.model.period_to) {
            this.model.period_to =
              this.lastDayOfMonth(this.model.period_to);
          }
        }

        this.loadPropertyTenants(
          entry.property_id,
          entry.tenant_id ?? null
        );

        this.loading = false;
      },

      error: error => {
        this.loading = false;

        this.errorMessage =
          error?.error?.message ||
          'Unable to load transaction.';
      }
    });
  }

  onTypeChange(): void {
    this.resetCategory();

    if (this.model.entry_type === 'EXPENSE') {
      this.model.tenant_id = null;

      // Rent period does not apply to expenses.
      this.model.period_from = null;
      this.model.period_to = null;
    } else {
      // Collection selected.
      this.setDefaultRentPeriod();
    }

    this.errorMessage = '';
  }

  private resetCategory(): void {
    this.model.category =
      this.categories[0] || '';
  }

  onPropertyChange(): void {
    this.model.tenant_id = null;

    if (this.model.property_id) {
      this.loadPropertyTenants(
        this.model.property_id
      );
    } else {
      this.propertyTenants = [];
    }
  }

  loadPropertyTenants(
    propertyId: number,
    tenantIdToKeep: number | null = null
  ): void {
    this.api.getTenantsByProperty(propertyId).subscribe({
      next: response => {
        this.propertyTenants =
          response.data || [];

        if (
          tenantIdToKeep &&
          this.propertyTenants.some(
            x => x.id === tenantIdToKeep
          )
        ) {
          this.model.tenant_id =
            tenantIdToKeep;
        }
      },

      error: () => {
        this.propertyTenants = [];
      }
    });
  }

  submit(): void {
    this.errorMessage = '';

    /*
     * Basic validation.
     *
     * Payment Date is intentionally independent
     * from the rent period.
     */
    if (
      !this.model.entry_date ||
      !this.model.property_id ||
      !this.model.category ||
      !this.model.amount ||
      this.model.amount <= 0
    ) {
      this.errorMessage =
        'Please fill all required fields and enter a valid amount.';

      return;
    }

    /*
     * Collection-specific validation.
     */
    if (this.model.entry_type === 'COLLECTION') {

      if (!this.model.tenant_id) {
        this.errorMessage =
          'Tenant is required for rent collection.';

        return;
      }

      if (!this.model.period_from) {
        this.errorMessage =
          'Rent Period From is required.';

        return;
      }

      if (!this.model.period_to) {
        this.errorMessage =
          'Rent Period To is required.';

        return;
      }

      /*
       * From MUST be first day of its month.
       */
      const expectedFrom =
        this.firstDayOfMonth(
          this.model.period_from
        );

      if (
        this.model.period_from !== expectedFrom
      ) {
        this.errorMessage =
          'Rent Period From must be the first day of the month.';

        return;
      }

      /*
       * To MUST be last day of its selected month.
       */
      const expectedTo =
        this.lastDayOfMonth(
          this.model.period_to
        );

      if (
        this.model.period_to !== expectedTo
      ) {
        this.errorMessage =
          'Rent Period To must be the last day of the month.';

        return;
      }

      /*
       * Multiple months are allowed.
       *
       * Only invalid condition:
       * To month is before From month.
       */
      if (
        this.model.period_to <
        this.model.period_from
      ) {
        this.errorMessage =
          'Rent Period To cannot be before Rent Period From.';

        return;
      }

    } else {

      /*
       * Expenses do not have a rent period.
       */
      this.model.period_from = null;
      this.model.period_to = null;
    }

    this.saving = true;

    const request =
      this.isEditMode && this.editId
        ? this.api.updateEntry(
            this.editId,
            this.model
          )
        : this.api.createEntry(
            this.model
          );

    request.subscribe({
      next: response => {
        this.saving = false;

        if (
          response.data?.transaction_id
        ) {
          this.existingTransactionId =
            response.data.transaction_id;
        }

        this.router.navigate([
          '/tenant-rent/transactions'
        ]);
      },

      error: error => {
        this.saving = false;

        this.errorMessage =
          error?.error?.message ||
          'Unable to save transaction.';
      }
    });
  }
}