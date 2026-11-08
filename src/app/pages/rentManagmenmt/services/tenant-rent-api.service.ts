import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Entry,
  EntryPayload,
  Masters,
  MonthlyDashboard,
  Property,
  PropertyPayload,
  PropertyTenantOption,
  PropertyWiseDashboard,
  Tenant,
  TenantOverdue,
  TenantPayload,
  YearlyDashboard
} from '../models/tenant-rent.models';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class TenantRentApiService {
  private http = inject(HttpClient);

  // Change this only if your backend has a different API prefix.
 private readonly baseUrl = '/api/tenant';

  // ---------------- Properties ----------------

  getProperties(includeInactive = false): Observable<ApiResponse<Property[]>> {
    let params = new HttpParams();
    if (includeInactive) params = params.set('include_inactive', 'true');

    return this.http.get<ApiResponse<Property[]>>(
      `${this.baseUrl}/properties`,
      { params }
    );
  }

  getProperty(id: number): Observable<ApiResponse<Property>> {
    return this.http.get<ApiResponse<Property>>(
      `${this.baseUrl}/properties/${id}`
    );
  }

  createProperty(payload: PropertyPayload): Observable<ApiResponse<Property>> {
    return this.http.post<ApiResponse<Property>>(
      `${this.baseUrl}/properties`,
      payload
    );
  }

  updateProperty(id: number, payload: PropertyPayload): Observable<ApiResponse<Property>> {
    return this.http.put<ApiResponse<Property>>(
      `${this.baseUrl}/properties/${id}`,
      payload
    );
  }

  deleteProperty(id: number): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(
      `${this.baseUrl}/properties/${id}`
    );
  }

  // ---------------- Tenants ----------------

  getTenants(options: {
    includeInactive?: boolean;
    propertyId?: number;
  } = {}): Observable<ApiResponse<Tenant[]>> {
    let params = new HttpParams();

    if (options.includeInactive) {
      params = params.set('include_inactive', 'true');
    }

    if (options.propertyId) {
      params = params.set('property_id', String(options.propertyId));
    }

    return this.http.get<ApiResponse<Tenant[]>>(
      `${this.baseUrl}/tenants`,
      { params }
    );
  }

  getTenant(id: number): Observable<ApiResponse<Tenant>> {
    return this.http.get<ApiResponse<Tenant>>(
      `${this.baseUrl}/tenants/${id}`
    );
  }

  createTenant(payload: TenantPayload): Observable<ApiResponse<Tenant>> {
    return this.http.post<ApiResponse<Tenant>>(
      `${this.baseUrl}/tenants`,
      payload
    );
  }

  updateTenant(id: number, payload: TenantPayload): Observable<ApiResponse<Tenant>> {
    return this.http.put<ApiResponse<Tenant>>(
      `${this.baseUrl}/tenants/${id}`,
      payload
    );
  }

  deleteTenant(id: number): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(
      `${this.baseUrl}/tenants/${id}`
    );
  }

  // ---------------- Entries ----------------

  getEntries(filters: {
    status?: string;
    entryType?: string;
    propertyId?: number;
    tenantId?: number;
    fromDate?: string;
    toDate?: string;
  } = {}): Observable<ApiResponse<Entry[]>> {
    let params = new HttpParams();

    if (filters.status) params = params.set('status', filters.status);
    if (filters.entryType) params = params.set('entry_type', filters.entryType);
    if (filters.propertyId) params = params.set('property_id', String(filters.propertyId));
    if (filters.tenantId) params = params.set('tenant_id', String(filters.tenantId));
    if (filters.fromDate) params = params.set('from_date', filters.fromDate);
    if (filters.toDate) params = params.set('to_date', filters.toDate);

    return this.http.get<ApiResponse<Entry[]>>(
      `${this.baseUrl}/entries`,
      { params }
    );
  }

  getEntry(id: number): Observable<ApiResponse<Entry>> {
    return this.http.get<ApiResponse<Entry>>(
      `${this.baseUrl}/entries/${id}`
    );
  }

  createEntry(payload: EntryPayload): Observable<ApiResponse<Entry>> {
    return this.http.post<ApiResponse<Entry>>(
      `${this.baseUrl}/entries`,
      payload
    );
  }

  updateEntry(id: number, payload: EntryPayload): Observable<ApiResponse<Entry>> {
    return this.http.put<ApiResponse<Entry>>(
      `${this.baseUrl}/entries/${id}`,
      payload
    );
  }

  voidEntry(id: number): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(
      `${this.baseUrl}/entries/${id}`
    );
  }

  // ---------------- Masters ----------------

  getMasters(): Observable<ApiResponse<Masters>> {
    return this.http.get<ApiResponse<Masters>>(
      `${this.baseUrl}/masters`
    );
  }

  getTenantsByProperty(propertyId: number): Observable<ApiResponse<PropertyTenantOption[]>> {
    const params = new HttpParams()
      .set('property_id', String(propertyId));

    return this.http.get<ApiResponse<PropertyTenantOption[]>>(
      `${this.baseUrl}/masters/tenants`,
      { params }
    );
  }

  // ---------------- Dashboard ----------------

  getMonthlyDashboard(month: string): Observable<ApiResponse<MonthlyDashboard>> {
    const params = new HttpParams().set('month', month);

    return this.http.get<ApiResponse<MonthlyDashboard>>(
      `${this.baseUrl}/dashboard/monthly`,
      { params }
    );
  }

  getYearlyDashboard(year: number): Observable<ApiResponse<YearlyDashboard>> {
    const params = new HttpParams().set('year', String(year));

    return this.http.get<ApiResponse<YearlyDashboard>>(
      `${this.baseUrl}/dashboard/yearly`,
      { params }
    );
  }

  getPropertyWiseDashboard(options: {
    month?: string;
    year?: number;
  }): Observable<ApiResponse<PropertyWiseDashboard>> {
    let params = new HttpParams();

    if (options.month) params = params.set('month', options.month);
    if (options.year) params = params.set('year', String(options.year));

    return this.http.get<ApiResponse<PropertyWiseDashboard>>(
      `${this.baseUrl}/dashboard/property-wise`,
      { params }
    );
  }

  getTenantOverdue(): Observable<ApiResponse<TenantOverdue[]>> {
    return this.http.get<ApiResponse<TenantOverdue[]>>(
      `${this.baseUrl}/dashboard/tenant-overdue`
    );
  }
}
