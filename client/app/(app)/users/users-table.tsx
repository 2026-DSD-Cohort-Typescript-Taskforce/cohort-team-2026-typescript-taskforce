'use client';

import type { SortingState } from '@tanstack/react-table';
import { ActionsMenu } from '@/components/ui/actions-menu';
import { DataTable, type Column } from '@/components/ui/data-table';
import { chipsFor, type UserRow } from '@/lib/user-directory';
import { PendingChip } from './pending-chip';

const chip =
  'inline-flex shrink-0 items-center rounded-full border font-semibold whitespace-nowrap';

// One tone per role (users.role CHECK), in the tones of bills/status-chip.tsx. Unknown roles
// look like viewers.
const roleTones: Record<string, string> = {
  viewer: 'border-strong bg-raised text-foreground',
  billing_operator: 'border-info-border bg-info-surface text-info-foreground',
  financial_approver: 'border-success-border bg-success-surface text-success-foreground',
  system_admin: 'border-primary bg-surface text-primary',
};

function RoleChip({ row }: { row: UserRow }) {
  if (!row.role) return <>—</>;
  return (
    <span className={`${chip} px-3 py-1 text-caption ${roleTones[row.role] ?? roleTones.viewer}`}>
      {row.roleLabel}
    </span>
  );
}

const propertyChip = `${chip} border-subtle bg-raised px-2 py-0.5 text-caption text-foreground`;

/** The first two properties, then "+N more", which names the rest on hover and to readers. */
function PropertyChips({ names }: { names: string[] }) {
  if (names.length === 0) return <>—</>;
  const { shown, more } = chipsFor(names);
  const rest = names.slice(shown.length);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((name) => (
        <span key={name} className={propertyChip}>
          {name}
        </span>
      ))}
      {more > 0 && (
        <span className={propertyChip} title={rest.join(', ')}>
          +{more} more<span className="sr-only">: {rest.join(', ')}</span>
        </span>
      )}
    </span>
  );
}

// Module scope, so DataTable's column definitions stay the same between renders. Sorting and
// the column filters use the text values (roleLabel, properties); the chips only display.
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
  { key: 'roleLabel', label: 'User Role', render: (row) => <RoleChip row={row} /> },
  { key: 'email', label: 'User Email' },
  { key: 'phone', label: 'User Phone', render: (row) => (row.phone?.trim() ? row.phone : '—') },
  {
    key: 'properties',
    label: 'Associated Properties',
    render: (row) => <PropertyChips names={row.propertyNames} />,
  },
];

const initialSorting: SortingState = [{ id: 'name', desc: false }];
// A renamed user moves when the list reloads; focus goes back to their ⋮, not a neighbour's.
const rowId = (row: UserRow) => String(row.user_id);

/**
 * The Users table. The Filter button stands in for the wireframe's "Manage Filters". Each
 * row's ⋮ menu edits the user, and resends the invite while they are pending.
 */
export function UsersTable({
  rows,
  onEdit,
  onResend,
  resendingId,
}: {
  rows: UserRow[];
  onEdit: (row: UserRow, opener: HTMLButtonElement) => void;
  onResend: (row: UserRow) => void;
  /** The user whose invite is being resent, if any. */
  resendingId: number | null;
}) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      initialSorting={initialSorting}
      getRowId={rowId}
      rowAction={{
        label: 'Actions',
        render: (row) => (
          <ActionsMenu
            label={`Actions for ${row.name}`}
            actions={[
              { label: 'Edit user', onSelect: (opener) => onEdit(row, opener) },
              ...(row.pending
                ? [
                    {
                      label: resendingId === row.user_id ? 'Resending invite…' : 'Resend invite',
                      onSelect: () => onResend(row),
                      disabled: resendingId !== null,
                    },
                  ]
                : []),
            ]}
          />
        ),
      }}
    />
  );
}
