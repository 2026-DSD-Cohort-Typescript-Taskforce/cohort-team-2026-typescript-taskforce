'use client';

import type { SortingState } from '@tanstack/react-table';
import { DataTable, type Column } from '@/components/ui/data-table';
import type { UserRow } from '@/lib/user-directory';
import { Spinner, colorTransition, focusRing } from '@/app/ui';
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

/**
 * The Users table. The Filter button stands in for the wireframe's "Manage Filters". A
 * pending user's row can resend the invite, for a link that expired or never arrived.
 */
export function UsersTable({
  rows,
  onResend,
  resendingId,
}: {
  rows: UserRow[];
  onResend: (row: UserRow) => void;
  /** The user whose invite is being resent, if any. */
  resendingId: number | null;
}) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      initialSorting={initialSorting}
      rowAction={{
        label: 'Invite',
        render: (row) =>
          row.pending && (
            <button
              type="button"
              onClick={() => onResend(row)}
              aria-disabled={resendingId !== null || undefined}
              data-pending={resendingId === row.user_id || undefined}
              aria-label={`Resend invite to ${row.name}`}
              className={`inline-flex h-10 items-center gap-2 rounded-button px-3 text-body-sm font-semibold whitespace-nowrap text-primary hover:bg-overlay aria-disabled:cursor-not-allowed data-pending:cursor-wait ${colorTransition} ${focusRing}`}
            >
              {resendingId === row.user_id && <Spinner />}
              Resend invite
            </button>
          ),
      }}
    />
  );
}
