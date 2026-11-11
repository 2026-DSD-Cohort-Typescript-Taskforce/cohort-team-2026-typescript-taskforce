export interface Vendor {
    vendor_id: number;
    address: string | null;
    name: string;
    contact_name: string | null;
    phone: string | null;
    payment_portal_url: string;
    supported_payment_methods: string;
    created_at: string;
    updated_at: string | null;
}

export interface CreateVendorInput {
    name: string;
    payment_portal_url: string;
    supported_payment_methods: string;
    address?: string | null;
    contact_name?: string | null;
    phone?: string | null;
}
