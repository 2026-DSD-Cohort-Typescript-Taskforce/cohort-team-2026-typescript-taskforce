import type {
    Bill,
    CreateBillInput
} from "@/types/bill";

const billsUrl = `${process.env.NEXT_PUBLIC_SUPABASE_DATA_API_BASE_URL}/bills`;

export type UpdateBillInput = Partial<CreateBillInput>;

export async function createBill(
    data: CreateBillInput, 
    accessToken: string
): Promise<Bill>{
    const response = await fetch(`${billsUrl}`, {
        method: "POST", 
        headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Prefer: "return=representation"
        },
        body: JSON.stringify(data)
    })

    if (!response.ok) {
        throw new Error(`Failed to create bill: ${await response.text()}`);
    }

    const bills: Bill[] = await response.json();

    if (!bills[0]) {
        throw new Error("No created bill was returned.");
    };
    
    return bills[0];
}

export async function fetchBills(): Promise<Bill[]> {
    const result = await fetch(billsUrl, {
        headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
        }
    });

    if (!result.ok) {
        throw new Error(`Failed to fetch bills: ${result.status}`);
    }

    return result.json();
}

export async function fetchBillById(id: string): Promise<Bill | null>{
    const billByIdUrl = `${billsUrl}?bill_id=eq.${encodeURIComponent(id)}&limit=1`

    const result = await fetch(billByIdUrl, {
        headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
        }
    });

    if (!result.ok) {
        throw new Error(`Failed to fetch bills: ${result.status}`);
    }

    const bills: Bill[] = await result.json();

    return bills[0] ?? null;    
}

export async function updateBill(
    id: string,
    accessToken: string, 
    data: UpdateBillInput
): Promise<Bill | null> {
    const billByIdUrl = `${billsUrl}?bill_id=eq.${encodeURIComponent(id)}`;

    const response = await fetch(billByIdUrl, {
        method: "PATCH", 
        headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Prefer: "return=representation"
        },
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        throw new Error(`Failed to update bill: ${await response.text()}`);
    }

    const bills: Bill[] = await response.json();
    return bills[0] ?? null;   
}

export async function deleteBill(
    id: string,
    accessToken: string, 
): Promise<number> {
    const billByIdUrl = `${billsUrl}?bill_id=eq.${encodeURIComponent(id)}`;

    const response = await fetch(billByIdUrl, {
        method: "DELETE", 
        headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to delete bill: ${await response.text()}`);
    }

    return response.status;
}


