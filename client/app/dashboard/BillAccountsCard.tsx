import { InfoCard, StatusLabel } from '@/components/ui/InfoCard';

export type BillStatus =
  | 'draft'
  | 'pending_approval'
  | 'approval_denied'
  | 'pending_payment'
  | 'processing'
  | 'payment_success'
  | 'payment_failed';

export type BillStatusCounts = Record<BillStatus, number>;

const EMPTY: BillStatusCounts = {
  draft: 0,
  pending_approval: 0,
  approval_denied: 0,
  pending_payment: 0,
  processing: 0,
  payment_success: 0,
  payment_failed: 0,
};

// Data Call: to be updated, not currently pulling data
// count all bills / status
export async function getBillStatusCounts(): Promise<BillStatusCounts> {
  return EMPTY;
}

// helper - bill status buckets
function toBuckets(c: BillStatusCounts) {
  const n = (s: BillStatus) => c[s] ?? 0;
  return {
    total: Object.values(c).reduce((sum, v) => sum + (v ?? 0), 0),
    paid: n('payment_success'),
    pendingReview: n('pending_approval') + n('pending_payment'),
    needsAttention: n('payment_failed') + n('approval_denied'),
  };
}

export async function BillAccountsCard() {
  const counts = await getBillStatusCounts().catch(() => EMPTY);
  const b = toBuckets(counts);
  const columns = [
    { count: b.paid, label: 'Paid', tone: 'success' },
    { count: b.pendingReview, label: 'Pending Review', tone: 'warning' },
    { count: b.needsAttention, label: 'Need Attention', tone: 'danger' },
  ] as const;

  return (
    <InfoCard title={`Bill Accounts (${b.total})`}>
      <ul className="flex flex-wrap justify-between gap-4">
        {columns.map(({ count, label, tone }) => (
          <li key={label} className="flex flex-col gap-1">
            <span className="text-body">
              {count} {count === 1 ? 'Account' : 'Accounts'}
            </span>
            <StatusLabel tone={tone} label={label} />
          </li>
        ))}
      </ul>
    </InfoCard>
  );
}
