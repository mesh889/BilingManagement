import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Bill, PartyDetails } from '../models/bill.model';

@Injectable({ providedIn: 'root' })
export class BillService {
  private http = inject(HttpClient);
  private baseUrl = 'http://localhost:3000';
  private api = `${this.baseUrl}/api/bills`;

  getAll(): Observable<Bill[]> {
    return this.http.get<Bill[]>(this.api);
  }

  getById(id: string): Observable<Bill> {
    return this.http.get<Bill>(`${this.api}/${id}`);
  }

  create(bill: Bill): Observable<Bill> {
    return this.http.post<Bill>(this.api, bill);
  }

  update(id: string, bill: Bill): Observable<Bill> {
    return this.http.put<Bill>(`${this.api}/${id}`, bill);
  }

  delete(id: string): Observable<any> {
    return this.http.delete(`${this.api}/${id}`);
  }

  getUniqueBuyers(): Observable<PartyDetails[]> {
    return this.http.get<PartyDetails[]>(`${this.baseUrl}/api/parties/buyers`);
  }

  getUniqueSuppliers(): Observable<PartyDetails[]> {
    return this.http.get<PartyDetails[]>(`${this.baseUrl}/api/parties/suppliers`);
  }

  backup(): Observable<any> {
    return this.http.get(`${this.baseUrl}/api/backup`);
  }

  restore(data: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/api/restore`, data);
  }

  getBackupFiles(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/api/backup/files`);
  }

  deleteBackupFile(filename: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/api/backup/files/${filename}`);
  }

  downloadBackupFile(filename: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/api/backup/files/${filename}`);
  }

  // Purchases
  getPurchases(): Observable<any[]> { return this.http.get<any[]>(`${this.baseUrl}/api/purchases`); }
  getPurchaseById(id: string): Observable<any> { return this.http.get(`${this.baseUrl}/api/purchases/${id}`); }
  createPurchase(p: any): Observable<any> { return this.http.post(`${this.baseUrl}/api/purchases`, p); }
  updatePurchase(id: string, p: any): Observable<any> { return this.http.put(`${this.baseUrl}/api/purchases/${id}`, p); }
  deletePurchase(id: string): Observable<any> { return this.http.delete(`${this.baseUrl}/api/purchases/${id}`); }

  // Report
  getReport(
  year?: string,
  month?: string,
  supplier?: string,
  fromDate?: string,
  toDate?: string,
  excludeProforma: boolean = true,
  excludeQuotation: boolean = true
): Observable<any> {

  const params = new URLSearchParams();

  if (year) {
    params.set('year', year);
  }

  if (month) {
    params.set('month', month);
  }

  if (supplier) {
    params.set('supplier', supplier);
  }

  if (fromDate) {
    params.set('fromDate', fromDate);
  }

  if (toDate) {
    params.set('toDate', toDate);
  }

  params.set(
    'excludeProforma',
    String(excludeProforma)
  );

  params.set(
    'excludeQuotation',
    String(excludeQuotation)
  );

  const queryString = params.toString();

  return this.http.get(
    `${this.baseUrl}/api/report${queryString ? '?' + queryString : ''}`
  );
}

}
