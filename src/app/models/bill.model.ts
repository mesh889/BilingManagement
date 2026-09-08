export interface PartyDetails {
  name: string;
  gstNo: string;
  pan: string;
  address: string;
  phone: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
}

export interface BillItem {
  srNo: number;
  description: string;
  hsnSac: string;
  unit: number | null;
  quantity: number | null;
  rate: number | null;
  discount: number | null;
  cgstPercent: number | null;
  sgstPercent: number | null;
  amount: number;
}

export interface GstSummaryRow {
  hsnSac: string;
  taxableValue: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  totalTax: number;
}

export interface BankDetails {
  bankName: string;
  accountNumber: string;
  ifscCode: string;
}

export interface Bill {
  id?: string;
  billNumber: string;
  billDate: string;
  buyer: PartyDetails;
  supplier: PartyDetails;
  items: BillItem[];
  bankDetails: BankDetails;
  totalAmount: number;
  totalGst: number;
  grandTotal: number;
}
