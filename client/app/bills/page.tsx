// TESTING PURPOSES ONLY - please feel free to delete 
"use client";

import { useEffect, useState } from "react";
import { fetchBillById, fetchBills, createBill, updateBill } from "../../lib/bills";
import type { Bill } from "@/types/bill";

export default function BillsPage() {
    const [bills, setBills] = useState<Bill[]>([]);
    const [bill, setBill] = useState<Bill | null>(null);

    useEffect(() => {
        fetchBills()
            .then(setBills)
            .catch(console.error);
        fetchBillById("1")
            .then(setBill)
            .catch(console.error);
    }, []);

    return (
        <div>
            {/* rendering all bills */}
            <ul>
                {bills.map((bill) => (
                    <li key={bill.bill_id}>
                        {bill.bill_id}: ${bill.amount}
                    </li>
                ))}
            </ul>  

            {/* rendering 1 bill */}
            {bill && (
                <div>
                    <p>Invoice: {bill.invoice_number}</p>
                    <p>Amount: {bill.amount}</p>
                    <p>Status: {bill.status}</p>
                </div>
            )}

            {/* create bill  */}
            <button
                onClick={async () => {
                    try {
                        const bill = await createBill(
                            { amount: 125, status: "draft" },
                            process.env.NEXT_PUBLIC_TEST_ACCESS_TOKEN!
                        );
                        console.log("Created bill:", bill);
                    } catch (error) {
                        console.error(error);
                    }
                }}
            >
                Create test bill
            </button>

            <button
                onClick={async () => {
                    try {
                        const bill = await updateBill(
                            "11",
                            process.env.NEXT_PUBLIC_TEST_ACCESS_TOKEN!,
                            { 
                                amount: 100000, 
                                date_due: "2026-11-11",
                                invoice_number: "BILL-1001", 
                                status: "pending_payment"
                            }
                        );
                        console.log("Updated bill:", bill);
                    } catch (error) {
                        console.error(error);
                    }
                }}
            >
                Update test bill
            </button>
                    
        </div>

    
    );
}