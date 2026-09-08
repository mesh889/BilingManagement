import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { BillService } from '../../services/bill.service';

@Component({
  selector: 'app-purchase-form',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './purchase-form.component.html',
  styleUrl: './purchase-form.component.scss'
})
export class PurchaseFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private svc = inject(BillService);

  isEdit = false;
  editId: string | null = null;

  form = { invoiceNo: '', invoiceDate: '', name: '', gstNo: '', taxableAmount: 0, cgst: 0, sgst: 0 };

  ngOnInit() {
    this.editId = this.route.snapshot.paramMap.get('id');
    this.isEdit = !!this.editId;
    if (this.isEdit && this.editId) {
      this.svc.getPurchaseById(this.editId).subscribe(p => {
        this.form = { invoiceNo: p.invoiceNo, invoiceDate: p.invoiceDate, name: p.name, gstNo: p.gstNo, taxableAmount: p.taxableAmount, cgst: p.cgst, sgst: p.sgst };
      });
    } else {
      this.form.invoiceDate = new Date().toISOString().split('T')[0];
    }
  }

  get totalWithTax(): number { return +(this.form.taxableAmount + this.form.cgst + this.form.sgst).toFixed(2); }

  save() {
    const done = () => { this.router.navigate(['/purchases']); };
    if (this.isEdit && this.editId) this.svc.updatePurchase(this.editId, this.form).subscribe(done);
    else this.svc.createPurchase(this.form).subscribe(done);
  }
}
