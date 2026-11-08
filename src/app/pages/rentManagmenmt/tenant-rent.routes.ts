import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';
import { TransactionListComponent } from './transactions/transaction-list.component';
import { TransactionFormComponent } from './transactions/transaction-form.component';
import { TenantListComponent } from './tenants/tenant-list.component';
import { TenantFormComponent } from './tenants/tenant-form.component';
import { PropertyListComponent } from './properties/property-list.component';
import { PropertyFormComponent } from './properties/property-form.component';

export const tenantRentRoutes: Routes = [
  {
    path: '',
    component: DashboardComponent
  },
  {
    path: 'transactions',
    component: TransactionListComponent
  },
  {
    path: 'transactions/new',
    component: TransactionFormComponent
  },
  {
    path: 'transactions/:id/edit',
    component: TransactionFormComponent
  },
  {
    path: 'tenants',
    component: TenantListComponent
  },
  {
    path: 'tenants/new',
    component: TenantFormComponent
  },
  {
    path: 'tenants/:id/edit',
    component: TenantFormComponent
  },
  {
    path: 'properties',
    component: PropertyListComponent
  },
  {
    path: 'properties/new',
    component: PropertyFormComponent
  },
  {
    path: 'properties/:id/edit',
    component: PropertyFormComponent
  }
];
