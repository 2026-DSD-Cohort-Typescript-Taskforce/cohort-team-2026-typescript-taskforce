import { cookies } from 'next/headers';
import { InfoCard, StatusLabel } from '@/components/ui/InfoCard';
import { fetchLastSubmittedBill } from '@/lib/bills';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const tone = (status: string) =>
  status === 'payment_success'
    ? 'success'
    : status === 'payment_failed' || status === 'approval_denied'
      ? 'danger'
      : 'warning';

async function getLastSubmittedBill() {
  const token = (await cookies()).get('sb-access-token')?.value;
  if (!token) return null;
  return fetchLastSubmittedBill(token);
}

export async function LastSubmittedCard() {
  const bill = await getLastSubmittedBill().catch((error) => {
    console.error(error);
    return null;
  });
  return (
    <InfoCard title="Last Submitted">
      <p className="text-heading">{bill ? usd.format(bill.amount) : '-'}</p>
      <div className="mt-1 flex items-end justify-between gap-4 text-body-sm text-secondary">
        <span>{bill?.vendors?.vendor_name ?? 'No bills yet'}</span>
        {bill && (
          <StatusLabel
            tone={tone(bill.status)}
            label={`Status: ${bill.status.replaceAll('_', ' ')}`}
          />
        )}
      </div>
    </InfoCard>
  );
}
