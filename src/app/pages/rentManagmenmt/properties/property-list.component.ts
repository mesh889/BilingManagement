import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TenantRentApiService } from '../services/tenant-rent-api.service';
import { Property } from '../models/tenant-rent.models';

@Component({
  selector: 'app-property-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './property-list.component.html',
  styleUrl: './property-list.component.scss'
})
export class PropertyListComponent implements OnInit {
  private api = inject(TenantRentApiService);

  properties: Property[] = [];
  loading = false;
  errorMessage = '';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;

    this.api.getProperties(true).subscribe({
      next: response => {
        this.properties = response.data || [];
        this.loading = false;
      },
      error: error => {
        this.loading = false;
        this.errorMessage = error?.error?.message || 'Unable to load properties.';
      }
    });
  }

  deactivate(property: Property): void {
    if (!confirm(`Deactivate property ${property.property_name}?`)) return;

    this.api.deleteProperty(property.id).subscribe({
      next: () => this.load(),
      error: error => this.errorMessage = error?.error?.message || 'Unable to deactivate property.'
    });
  }
}
