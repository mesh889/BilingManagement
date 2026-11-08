import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TenantRentApiService } from '../services/tenant-rent-api.service';
import { Tenant } from '../models/tenant-rent.models';

@Component({
  selector: 'app-tenant-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './tenant-list.component.html',
  styleUrl: './tenant-list.component.scss'
})
export class TenantListComponent implements OnInit {
  private api = inject(TenantRentApiService);

  tenants: Tenant[] = [];
  loading = false;
  errorMessage = '';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;

    this.api.getTenants().subscribe({
      next: response => {
        this.tenants = response.data || [];
        this.loading = false;
      },
      error: error => {
        this.loading = false;
        this.errorMessage = error?.error?.message || 'Unable to load tenants.';
      }
    });
  }

  deactivate(tenant: Tenant): void {
    if (!confirm(`Deactivate tenant ${tenant.tenant_name}?`)) return;

    this.api.deleteTenant(tenant.id).subscribe({
      next: () => this.load(),
      error: error => this.errorMessage = error?.error?.message || 'Unable to deactivate tenant.'
    });
  }

  money(value: number | null | undefined): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR'
    }).format(value || 0);
  }
}
