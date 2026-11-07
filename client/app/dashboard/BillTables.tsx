import { cookies } from 'next/headers';
import { fetchPendingApprovalBills, fetchRecentPaidBills } from '@/lib/bills';
import { BillTable, type BillTableRow } from './BillTable';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

type BillRow = Awaited<ReturnType<typeof fetchRecentPaidBills>>[number];

const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const toRow = (b: BillRow, sub: string): BillTableRow => ({
  vendor: b.vendors?.vendor_name ?? '-',
  sub,
  amount: usd.format(b.amount),
});

// RLS scopes the query to the signed-in user; no token means no rows.
async function load(fetcher: (token: string) => Promise<BillRow[]>) {
  const token = (await cookies()).get('sb-access-token')?.value;
  return token ? fetcher(token).catch((e) => (console.error(e), [])) : [];
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
  console.log('Pending Approvals:', bills);
  return (
    <BillTable
      title="Pending Approvals"
      rows={bills.map((b) => toRow(b, `Status: ${b.status.replaceAll('_', ' ')}`))}
    />
  );
}
