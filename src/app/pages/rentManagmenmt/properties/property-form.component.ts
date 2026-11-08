import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TenantRentApiService } from '../services/tenant-rent-api.service';
import { Property, PropertyPayload, PropertyStatus } from '../models/tenant-rent.models';

@Component({
  selector: 'app-property-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './property-form.component.html',
  styleUrl: './property-form.component.scss'
})
export class PropertyFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(TenantRentApiService);

  isEditMode = false;
  editId: number | null = null;

  statuses: PropertyStatus[] = ['ACTIVE', 'INACTIVE'];

  model: PropertyPayload = {
    property_name: '',
    location: '',
    property_details: '',
    status: 'ACTIVE'
  };

  loading = false;
  saving = false;
  errorMessage = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');

    if (id) {
      this.isEditMode = true;
      this.editId = Number(id);
      this.loadProperty(this.editId);
    }
  }

  loadProperty(id: number): void {
    this.loading = true;

    this.api.getProperty(id).subscribe({
      next: response => {
        const property: Property = response.data;

        this.model = {
          property_code: property.property_code,
          property_name: property.property_name,
          location: property.location,
          property_details: property.property_details || '',
          status: property.status
        };

        this.loading = false;
      },
      error: error => {
        this.loading = false;
        this.errorMessage = error?.error?.message || 'Unable to load property.';
      }
    });
  }

  submit(): void {
    this.errorMessage = '';

    if (!this.model.property_name.trim() || !this.model.location.trim()) {
      this.errorMessage = 'Property name and location are required.';
      return;
    }

    this.saving = true;

    const request = this.isEditMode && this.editId
      ? this.api.updateProperty(this.editId, this.model)
      : this.api.createProperty(this.model);

    request.subscribe({
      next: () => {
        this.saving = false;
        this.router.navigate(['/tenant-rent/properties']);
      },
      error: error => {
        this.saving = false;
        this.errorMessage = error?.error?.message || 'Unable to save property.';
      }
    });
  }
}
