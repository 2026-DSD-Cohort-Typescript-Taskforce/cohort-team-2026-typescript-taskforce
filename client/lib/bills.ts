import {
    Bill,
    CreateBillInput
} from "@/types/bill";

const billsUrl = `${process.env.NEXT_PUBLIC_SUPABASE_DATA_API_BASE_URL}/bills`;

export type UpdateBillInput = Partial<CreateBillInput>;

export type CreateBillResponse = Bill;

// export async function createBill(
//     data: CreateBillInput
// ): Promise<CreateBillResponse>{
//     const response = await fetch(`${billsUrl}`, {
//         method: "POST", 
//         headers: {
            
//         }
//     })
//     return response;
// }

export async function fetchBills() {

    console.log("Fetching:", billsUrl);

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

export async function fetchBillById(){}

export async function updateBill(){}

export async function deleteBill(){}


