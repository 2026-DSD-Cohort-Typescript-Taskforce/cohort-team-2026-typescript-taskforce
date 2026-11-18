import { cookies } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { fetchPendingApprovalBills, fetchRecentPaidBills } from '@/lib/bills';
import { BillTable, type BillTableRow } from './BillTable';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

type BillRow = Awaited<ReturnType<typeof fetchRecentPaidBills>>[number];

const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const toRow = (b: BillRow, sub: string): BillTableRow => ({
  vendor: b.vendors?.name ?? '-',
  sub,
  amount: usd.format(b.amount),
});

async function load(fetcher: () => Promise<BillRow[]>) {
  // await cookies() outside the catch so Next can handle its prerender rejection
  await cookies();
  return fetcher().catch((e) => {
    // Next's prerender stops a no-store fetch by throwing; let Next handle that one
    unstable_rethrow(e);
    console.error(e);
    return [];
  });
}

export async function RecentPaymentsTable() {
  const bills = await load(fetchRecentPaidBills);
  return (
    <BillTable
      title="Recent Payments"
      rows={bills.map((b) => toRow(b, b.date_paid ? when.format(new Date(b.date_paid)) : '-'))}
    />
  );
}

export async function PendingApprovalsTable() {
  const bills = await load(fetchPendingApprovalBills);
  return (
    <BillTable
      title="Pending Approvals"
      rows={bills.map((b) => toRow(b, `Status: ${b.status.replaceAll('_', ' ')}`))}
    />
  );
}
