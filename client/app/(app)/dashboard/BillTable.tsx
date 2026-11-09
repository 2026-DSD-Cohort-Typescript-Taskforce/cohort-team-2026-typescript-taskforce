'use client';

import { DataTable, type Column } from '@/components/ui/data-table';

export type BillTableRow = { vendor: string; sub: string; amount: string };

// render lives here because functions can't be passed from server components
const columns: Column<BillTableRow>[] = [
  {
    key: 'vendor',
    label: 'Vendor',
    render: (r) => (
      <>
        <div>{r.vendor}</div>
        <div className="text-body-sm text-secondary">{r.sub}</div>
      </>
    ),
  },
  { key: 'amount', label: 'Amount' },
];

export function BillTable({ title, rows }: { title: string; rows: BillTableRow[] }) {
  return <DataTable title={title} columns={columns} rows={rows} />;
}
