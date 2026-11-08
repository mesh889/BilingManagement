import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TenantRentApiService } from '../services/tenant-rent-api.service';
import { Entry, MonthlyDashboard, PropertyWiseDashboard, TenantOverdue, YearlyDashboard } from '../models/tenant-rent.models';

interface GraphSeries { propertyId: number; propertyName: string; color: string; values: number[]; }

@Component({
  selector: 'app-tenant-rent-dashboard', standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './dashboard.component.html', styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  private api = inject(TenantRentApiService);
  viewMode: 'monthly' | 'yearly' = 'monthly';
  selectedMonth = this.currentMonth();
  selectedYear = new Date().getFullYear();
  rangeFrom = this.financialYearStart();
  rangeTo = this.financialYearEnd();
  monthly: MonthlyDashboard | null = null;
  yearly: YearlyDashboard | null = null;
  propertyWise: PropertyWiseDashboard | null = null;
  overdue: TenantOverdue[] = [];
  graphMonths: string[] = [];
  graphSeries: GraphSeries[] = [];
  graphMax = 1;
  graphLoading = false;
  readonly graphWidth = 1000;
  readonly graphHeight = 360;
  readonly graphLeft = 62;
  readonly graphRight = 24;
  readonly graphTop = 24;
  readonly graphBottom = 58;
  readonly propertyColors = ['#2563eb','#16a34a','#dc2626','#9333ea','#ea580c','#0891b2','#ca8a04','#db2777','#4f46e5','#059669'];
  loading = false;
  errorMessage = '';

  ngOnInit(): void { this.loadMonthly(); this.loadOverdue(); this.loadCollectionGraph(); }
  currentMonth(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
  private financialYearStart(): string { const d = new Date(); const year = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear()-1; return `${year}-04-01`; }
  private financialYearEnd(): string { return `${Number(this.financialYearStart().slice(0,4))+1}-03-31`; }

  loadMonthly(): void {
    this.loading = true; this.errorMessage = '';
    this.api.getMonthlyDashboard(this.selectedMonth).subscribe({
      next: response => { this.monthly = response.data; this.loadPropertyWiseMonth(); },
      error: error => this.handleError(error)
    });
  }
  private loadPropertyWiseMonth(): void {
    this.api.getPropertyWiseDashboard({ month: this.selectedMonth }).subscribe({
      next: response => { this.propertyWise = response.data; this.loading = false; },
      error: error => this.handleError(error)
    });
  }
  loadYearly(): void {
    this.loading = true; this.errorMessage = '';
    this.api.getYearlyDashboard(this.selectedYear).subscribe({
      next: response => { this.yearly = response.data; this.loading = false; },
      error: error => this.handleError(error)
    });
  }
  loadOverdue(): void { this.api.getTenantOverdue().subscribe({ next: response => this.overdue = response.data || [], error: () => this.overdue = [] }); }
  refresh(): void { this.loadCollectionGraph(); this.loadOverdue(); this.viewMode === 'monthly' ? this.loadMonthly() : this.loadYearly(); }

  onRangeChange(): void {
    if (!this.rangeFrom || !this.rangeTo) return;
    if (this.rangeFrom > this.rangeTo) [this.rangeFrom, this.rangeTo] = [this.rangeTo, this.rangeFrom];
    this.loadCollectionGraph();
  }

  loadCollectionGraph(): void {
    if (!this.rangeFrom || !this.rangeTo) return;
    this.graphLoading = true;
    this.api.getEntries({ status: 'POSTED', entryType: 'COLLECTION', fromDate: this.rangeFrom, toDate: this.rangeTo }).subscribe({
      next: response => { this.buildCollectionGraph(response.data || []); this.graphLoading = false; },
      error: error => { console.error(error); this.graphSeries = []; this.graphMonths = this.buildMonths(this.rangeFrom, this.rangeTo); this.graphMax = 1; this.graphLoading = false; }
    });
  }

  private buildCollectionGraph(entries: Entry[]): void {
    this.graphMonths = this.buildMonths(this.rangeFrom, this.rangeTo);
    const propertyMap = new Map<number, { propertyName: string; values: number[] }>();
    for (const entry of entries) {
      if (entry.entry_type !== 'COLLECTION') continue;
      const monthIndex = this.graphMonths.indexOf(entry.entry_date.slice(0,7));
      if (monthIndex < 0) continue;
      if (!propertyMap.has(entry.property_id)) propertyMap.set(entry.property_id, { propertyName: entry.property_name || `Property ${entry.property_id}`, values: this.graphMonths.map(() => 0) });
      propertyMap.get(entry.property_id)!.values[monthIndex] += Number(entry.amount || 0);
    }
    this.graphSeries = Array.from(propertyMap.entries()).sort((a,b) => a[1].propertyName.localeCompare(b[1].propertyName)).map(([propertyId, value], index) => ({ propertyId, propertyName: value.propertyName, color: this.propertyColors[index % this.propertyColors.length], values: value.values.map(v => Number(v.toFixed(2))) }));
    this.graphMax = Math.max(...this.graphSeries.flatMap(s => s.values), 1);
  }

  private buildMonths(from: string, to: string): string[] {
    const result: string[] = [];
    const [startYear,startMonth] = from.slice(0,7).split('-').map(Number);
    const [endYear,endMonth] = to.slice(0,7).split('-').map(Number);
    let year=startYear, month=startMonth;
    while (year < endYear || (year === endYear && month <= endMonth)) { result.push(`${year}-${String(month).padStart(2,'0')}`); month++; if (month===13) { month=1; year++; } }
    return result;
  }
  monthLabel(month: string): string { const [year,m] = month.split('-').map(Number); return new Intl.DateTimeFormat('en-IN',{month:'short',year:'numeric'}).format(new Date(year,m-1,1)); }
  shortMonthLabel(month: string): string { const [year,m] = month.split('-').map(Number); return new Intl.DateTimeFormat('en-IN',{month:'short'}).format(new Date(year,m-1,1)); }
  graphX(index: number): number { const plotWidth=this.graphWidth-this.graphLeft-this.graphRight; return this.graphMonths.length<=1 ? this.graphLeft+plotWidth/2 : this.graphLeft+(index/(this.graphMonths.length-1))*plotWidth; }
  graphY(value: number): number { const plotHeight=this.graphHeight-this.graphTop-this.graphBottom; return this.graphTop+(1-value/this.graphMax)*plotHeight; }
  seriesPoints(series: GraphSeries): string { return series.values.map((value,index)=>`${this.graphX(index)},${this.graphY(value)}`).join(' '); }
  graphGridY(level: number): number { return this.graphY((this.graphMax/4)*level); }
  graphGridLabel(level: number): string { return this.compactMoney((this.graphMax/4)*level); }
  compactMoney(value: number): string { const a=Number(value||0); if(a>=10000000)return `₹${(a/10000000).toFixed(1)}Cr`; if(a>=100000)return `₹${(a/100000).toFixed(1)}L`; if(a>=1000)return `₹${(a/1000).toFixed(0)}K`; return `₹${Math.round(a)}`; }
  money(value: number | null | undefined): string { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(value||0); }
  maxMonthlyValue(): number { const rows=this.yearly?.monthly_breakdown||[]; return Math.max(...rows.map(x=>Math.max(x.collection,x.expense)),1); }
  barWidth(value: number): string { return `${Math.max(2,Math.round((value/this.maxMonthlyValue())*100))}%`; }
  private handleError(error: any): void { this.loading=false; this.errorMessage=error?.error?.message||error?.message||'Unable to load dashboard data.'; }
}
