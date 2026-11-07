'use client';

import { useEffect, useState } from 'react';
import {
  fetchBillById,
  fetchBills,
  createBill,
  updateBill,
  fetchLastSubmittedBillByUserId,
} from '@/lib/bills';
import type { Bill } from '@/types/bill';

export default function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [bill, setBill] = useState<Bill | null>(null);
  const [lastSubmittedBill, setLastSubmittedBill] = useState<Bill | null>(null);

  useEffect(() => {
    fetchBills().then(setBills).catch(console.error);
    fetchBillById('3').then(setBill).catch(console.error);
    fetchLastSubmittedBillByUserId('6').then(setLastSubmittedBill).catch(console.error);
  }, []);

  return (
    <div>
      {/* rendering all bills */}
      <ul>
        fetchBills()
        {bills.map((bill) => (
          <li key={bill.bill_id}>
            {bill.bill_id}: ${bill.amount}
          </li>
        ))}
      </ul>

      {/* rendering 1 bill */}
      {bill && (
        <div>
          <br></br>
          fetchBillById()
          <p>Invoice: {bill.invoice_number}</p>
          <p>Amount: {bill.amount}</p>
          <p>Status: {bill.status}</p>
        </div>
      )}

      {/* create bill  */}
      <br />
      <button
        onClick={async () => {
          try {
            const bill = await createBill(
              { amount: 125, status: 'draft' },
              process.env.NEXT_PUBLIC_TEST_ACCESS_TOKEN!,
            );
            console.log('Created bill:', bill);
          } catch (error) {
            console.error(error);
          }
        }}
      >
        createBill() button
      </button>

      <br />

      <button
        onClick={async () => {
          try {
            const bill = await updateBill('11', process.env.NEXT_PUBLIC_TEST_ACCESS_TOKEN!, {
              amount: 100000,
              date_due: '2026-11-11',
              invoice_number: 'BILL-1001',
              status: 'pending_payment',
            });
            console.log('Updated bill:', bill);
          } catch (error) {
            console.error(error);
          }
        }}
      >
        updateBill() button
      </button>

      {lastSubmittedBill && (
        <section>
          <h2>fetchLastSubmittedBillByUserId()</h2>
          <p>Bill ID: {lastSubmittedBill.bill_id}</p>
          <p>Amount: {lastSubmittedBill.amount}</p>
          <p>Status: {lastSubmittedBill.status}</p>
        </section>
      )}
    </div>
  );
}
