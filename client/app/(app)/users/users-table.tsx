'use client';

import type { SortingState } from '@tanstack/react-table';
import { DataTable, type Column } from '@/components/ui/data-table';
import type { UserRow } from '@/lib/user-directory';
import { PendingChip } from './pending-chip';

// Module scope, so DataTable's column definitions stay the same between renders.
const columns: Column<UserRow>[] = [
  {
    key: 'name',
    label: 'Full Name',
    render: (row) => (
      <span className="flex flex-wrap items-center gap-2">
        <span>{row.name}</span>
        {row.pending && <PendingChip />}
      </span>
    ),
  },
  { key: 'roleLabel', label: 'User Role' },
  { key: 'email', label: 'User Email' },
  { key: 'phone', label: 'User Phone', render: (row) => (row.phone?.trim() ? row.phone : '—') },
  { key: 'properties', label: 'Associated Properties' },
];

const initialSorting: SortingState = [{ id: 'name', desc: false }];

/** The Users table. The Filter button stands in for the wireframe's "Manage Filters". */
export function UsersTable({ rows }: { rows: UserRow[] }) {
  return <DataTable columns={columns} rows={rows} initialSorting={initialSorting} />;
}
