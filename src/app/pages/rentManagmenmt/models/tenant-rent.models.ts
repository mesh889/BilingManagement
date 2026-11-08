export type PropertyStatus = 'ACTIVE' | 'INACTIVE';
export type TenantStatus = 'ACTIVE' | 'ENDED' | 'INACTIVE';
export type EntryType = 'COLLECTION' | 'EXPENSE';
export type EntryStatus = 'POSTED' | 'VOID';
export type PaymentMode = 'CASH' | 'BANK' | 'UPI' | 'OTHER';

export interface Property {
  id: number;
  property_code: string;
  property_name: string;
  location: string;
  property_details?: string | null;
  status: PropertyStatus;
  created_at?: string;
  updated_at?: string;
  active_tenant_count?: number;
}

export interface PropertyPayload {
  property_code?: string;
  property_name: string;
  location: string;
  property_details?: string;
  status?: PropertyStatus;
}

export interface Tenant {
  id: number;
  tenant_name: string;
  tenant_phone?: string | null;
  tenant_email?: string | null;
  property_id: number;
  property_code?: string;
  property_name?: string;
  location?: string;
  deposit_amount?: number | null;
  agreement_start_date: string;
  agreement_end_date?: string | null;
  rent_amount: number;
  status: TenantStatus;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TenantPayload {
  tenant_name: string;
  tenant_phone?: string;
  tenant_email?: string;
  property_id: number;
  deposit_amount?: number | null;
  agreement_start_date: string;
  agreement_end_date?: string | null;
  rent_amount: number;
  status?: TenantStatus;
  notes?: string;
}

export interface Entry {
  id: number;
  transaction_id: string;
  entry_date: string;
  period_from?: string | null;
  period_to?: string | null;
  entry_type: EntryType;
  property_id: number;
  property_code?: string;
  property_name?: string;
  tenant_id?: number | null;
  tenant_name?: string | null;
  category: string;
  amount: number;
  payment_mode?: PaymentMode | null;
  reference_no?: string | null;
  notes?: string | null;
  status: EntryStatus;
  created_at?: string;
  updated_at?: string;
}

export interface EntryPayload {
  entry_date: string;
  period_from?: string | null;
  period_to?: string | null;
  entry_type: EntryType;
  property_id: number;
  tenant_id?: number | null;
  category: string;
  amount: number;
  payment_mode?: PaymentMode | null;
  reference_no?: string | null;
  notes?: string | null;
  status?: EntryStatus;
}

export interface Masters {
  types: EntryType[];
  collection_categories: string[];
  expense_categories: string[];
  payment_modes: PaymentMode[];
  properties: Array<{
    id: number;
    property_code: string;
    property_name: string;
    location: string;
  }>;
  tenants: Array<{
    id: number;
    tenant_name: string;
    tenant_phone?: string | null;
    property_id: number;
    property_name?: string;
    rent_amount: number;
  }>;
}

export interface PropertyTenantOption {
  id: number;
  tenant_name: string;
  tenant_phone?: string | null;
  property_id: number;
  rent_amount: number;
  deposit_amount?: number | null;
  agreement_start_date: string;
  agreement_end_date?: string | null;
  status: TenantStatus;
}

export interface DashboardSummary {
  total_collection: number;
  total_expense: number;
  net_collection: number;
  transaction_count: number;
}

export interface MonthlyDashboard {
  month: string;
  from_date: string;
  to_date: string;
  summary: DashboardSummary;
  property_wise: Array<{
    property_id: number;
    property_code: string;
    property_name: string;
    collection: number;
    expense: number;
    net: number;
  }>;
  recent_entries: Entry[];
}

export interface YearlyDashboard {
  year: number;
  from_date: string;
  to_date: string;
  summary: DashboardSummary;
  monthly_breakdown: Array<{
    month: string;
    collection: number;
    expense: number;
    net: number;
  }>;
}

export interface PropertyWiseDashboard {
  from_date: string;
  to_date: string;
  properties: Array<{
    property_id: number;
    property_code: string;
    property_name: string;
    location: string;
    collection: number;
    expense: number;
    net: number;
    transaction_count: number;
  }>;
}

export interface TenantOverdue {
  id: number;
  tenant_name: string;
  tenant_phone?: string | null;
  property_id: number;
  property_name: string;
  property_code: string;
  agreement_start_date: string;
  agreement_end_date?: string | null;
  rent_amount: number;
  total_rent_collected: number;
  expected_months: number;
  expected_rent: number;
  overdue_amount: number;
}
