export interface Bill {
  bill_id: number;
  amount: number;
  property_id: number;
  vendor_id: number;
  user_id: number;
  payment_id: number;
  date_due: string | null;
  invoice_number: string | null;
  date_issued: string | null;
  date_received: string;
  date_paid: string | null;
  status: string;
  pdf_path: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CreateBillInput {
  amount: number;
  property_id: number;
  vendor_id: number;
  user_id: number;
  payment_id: number;
  date_due?: string | null;
  invoice_number?: string | null;
  date_issued?: string | null;
  date_received?: string;
  date_paid?: string | null;
  status?: string;
  pdf_path?: string | null;
}
