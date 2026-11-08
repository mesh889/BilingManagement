import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TenantRentApiService } from '../services/tenant-rent-api.service';
import { Property, Tenant, TenantPayload, TenantStatus } from '../models/tenant-rent.models';

@Component({
  selector: 'app-tenant-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './tenant-form.component.html',
  styleUrl: './tenant-form.component.scss'
})
export class TenantFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(TenantRentApiService);

  properties: Property[] = [];
  isEditMode = false;
  editId: number | null = null;

  model: TenantPayload = {
    tenant_name: '',
    tenant_phone: '',
    tenant_email: '',
    property_id: 0,
    deposit_amount: null,
    agreement_start_date: '',
    agreement_end_date: null,
    rent_amount: 0,
    status: 'ACTIVE',
    notes: ''
  };

  statuses: TenantStatus[] = ['ACTIVE', 'ENDED', 'INACTIVE'];
  loading = false;
  saving = false;
  errorMessage = '';

  ngOnInit(): void {
    this.loadProperties();

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEditMode = true;
      this.editId = Number(id);
      this.loadTenant(this.editId);
    }
  }

  loadProperties(): void {
    this.api.getProperties().subscribe({
      next: response => this.properties = response.data || [],
      error: error => this.errorMessage = error?.error?.message || 'Unable to load properties.'
    });
  }

  loadTenant(id: number): void {
    this.loading = true;

    this.api.getTenant(id).subscribe({
      next: response => {
        const tenant: Tenant = response.data;

        this.model = {
          tenant_name: tenant.tenant_name,
          tenant_phone: tenant.tenant_phone || '',
          tenant_email: tenant.tenant_email || '',
          property_id: tenant.property_id,
          deposit_amount: tenant.deposit_amount ?? null,
          agreement_start_date: tenant.agreement_start_date,
          agreement_end_date: tenant.agreement_end_date ?? null,
          rent_amount: tenant.rent_amount,
          status: tenant.status,
          notes: tenant.notes || ''
        };

        this.loading = false;
      },
      error: error => {
        this.loading = false;
        this.errorMessage = error?.error?.message || 'Unable to load tenant.';
      }
    });
  }

  submit(): void {
    this.errorMessage = '';

    if (!this.model.tenant_name.trim() ||
        !this.model.property_id ||
        !this.model.agreement_start_date ||
        !this.model.rent_amount ||
        this.model.rent_amount <= 0) {
      this.errorMessage = 'Please fill all required fields.';
      return;
    }

    this.saving = true;

    const request = this.isEditMode && this.editId
      ? this.api.updateTenant(this.editId, this.model)
      : this.api.createTenant(this.model);

    request.subscribe({
      next: () => {
        this.saving = false;
        this.router.navigate(['/tenant-rent/tenants']);
      },
      error: error => {
        this.saving = false;
        this.errorMessage = error?.error?.message || 'Unable to save tenant.';
      }
    });
  }
}
