import { Routes } from '@angular/router';
import { BillListComponent } from './pages/bill-list/bill-list.component';
import { BillFormComponent } from './pages/bill-form/bill-form.component';
import { BillViewComponent } from './pages/bill-view/bill-view.component';
import { BillPrintBulkComponent } from './pages/bill-print-bulk/bill-print-bulk.component';
import { BackupComponent } from './pages/backup/backup.component';
import { PurchaseListComponent } from './pages/purchase-list/purchase-list.component';
import { PurchaseFormComponent } from './pages/purchase-form/purchase-form.component';
import { ReportComponent } from './pages/report/report.component';

export const routes: Routes = [
  { path: '', redirectTo: 'bills', pathMatch: 'full' },
  { path: 'bills', component: BillListComponent },
  { path: 'bills/create', component: BillFormComponent },
  { path: 'bills/edit/:id', component: BillFormComponent },
  { path: 'bills/print/:id', component: BillViewComponent },
  { path: 'bills/print-bulk', component: BillPrintBulkComponent },
  { path: 'purchases', component: PurchaseListComponent },
  { path: 'purchases/create', component: PurchaseFormComponent },
  { path: 'purchases/edit/:id', component: PurchaseFormComponent },
  { path: 'report', component: ReportComponent },
  { path: 'backup', component: BackupComponent },
];
