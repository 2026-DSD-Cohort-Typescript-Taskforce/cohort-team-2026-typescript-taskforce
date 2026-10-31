"use client";

import { useEffect, useState } from "react";
import { fetchBills } from "../../lib/bills"; // Adjust path
import type { Bill } from "../types/bill";

export default function BillsPage() {
    const [bills, setBills] = useState<Bill[]>([]);

    useEffect(() => {
        fetchBills()
            .then(setBills)
            .catch(console.error);
    }, []);

    return (
        <ul>
            {bills.map((bill) => (
                <li key={bill.bill_id}>
                    Bill #{bill.bill_id}: ${bill.amount.toFixed(2)}
                </li>
            ))}
        </ul>
    );
}