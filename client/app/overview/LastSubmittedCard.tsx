import { InfoCard, StatusLabel } from './InfoCard';

export type LastPaidBill = {
  amount: number;
  vendorName: string | null;
  datePaid: string | null;
} | null;

// Data Call: to be updated, not currently pulling data
// newest bill .status == payment_success (ordered by date_paid desc, join vendors), null if none
export async function getLastPaidBill(): Promise<LastPaidBill | null> {
  return null;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export async function LastSubmittedCard() {
  const bill = await getLastPaidBill().catch(() => null);
  return (
    <InfoCard title="Last Submitted">
      <p className="text-heading">{bill ? usd.format(bill.amount) : '-'}</p>
      <div className="mt-1 flex items-end justify-between gap-4 text-body-sm text-secondary">
        <span>{bill?.vendorName ?? 'No bills yet'}</span>
        {bill && <StatusLabel tone="success" label="Status: Success" />}
      </div>
    </InfoCard>
  );
}
