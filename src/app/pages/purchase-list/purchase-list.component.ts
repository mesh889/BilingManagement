import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BillService } from '../../services/bill.service';

@Component({
  selector: 'app-purchase-list',
  imports: [CommonModule, RouterLink],
  templateUrl: './purchase-list.component.html',
  styleUrl: './purchase-list.component.scss'
})
export class PurchaseListComponent implements OnInit {
  private svc = inject(BillService);
  purchases: any[] = [];

  ngOnInit() { this.load(); }
  load() { this.svc.getPurchases().subscribe(d => this.purchases = d); }

  delete(id: number) {
    if (confirm('Delete this purchase?')) this.svc.deletePurchase(String(id)).subscribe(() => this.load());
  }
}
