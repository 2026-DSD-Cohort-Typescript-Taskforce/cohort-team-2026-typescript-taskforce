export interface Bill {
    bill_id: number;
    amount: number;
    property_id: number | null;
    vendor_id: number | null;
    user_id: number | null;
    payment_id: number | null;
    date_due: string | null;
    invoice_number: string | null;
    date_issued: string | null;
    date_received: string;
    date_paid: string | null;
    status: string;
    pdf_path: string | null;
    created_at: string;
    modified_at: string | null;
}

export interface CreateBillInput {
    amount: number;
    property_id?: number | null;
    vendor_id?: number | null;
    user_id?: number | null;
    payment_id?: number | null;
    date_due?: string | null;
    invoice_number?: string | null;
    date_issued?: string | null;
    date_received?: string;
    date_paid?: string | null;
    status?: string;
    pdf_path?: string | null;
}