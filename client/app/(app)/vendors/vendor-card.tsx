'use client';

import { useState } from 'react';
import { displayValue, type Vendor } from '@/lib/vendor-directory';
import { ActionsMenu } from '@/components/ui/actions-menu';

/** The vendor's logo, or a generic avatar when it has none or the image doesn't load. */
export function VendorAvatar({ src, className }: { src: string | null; className: string }) {
  // The src that failed, so a new logo gets its own try.
  const [failed, setFailed] = useState<string | null>(null);

  if (src && src !== failed) {
    return (
      // Plain <img>: the Supabase Storage host differs per environment.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        onError={() => setFailed(src)}
        className={`bg-raised object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center bg-raised text-secondary ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        className="size-1/2"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    </span>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-secondary"
    >
      <path d={d} />
    </svg>
  );
}

/** A detail, or a dash that reads as "Not set". */
function Value({ value }: { value: string | null }) {
  const shown = displayValue(value);
  if (shown !== '—') return shown;
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">Not set</span>
    </>
  );
}

/** One vendor in the grid. Managers get a ⋮ menu with "Edit vendor". */
export function VendorCard({
  vendor,
  canManage,
  onEdit,
}: {
  vendor: Vendor;
  canManage: boolean;
  /** The trigger is the ⋮ button, which gets focus back when the dialog closes. */
  onEdit: (vendor: Vendor, trigger: HTMLButtonElement) => void;
}) {
  return (
    <li className="flex flex-col gap-4 rounded-card border border-subtle bg-surface p-5">
      <div className="flex items-start gap-4">
        <VendorAvatar
          src={vendor.logo_url}
          className="size-14 shrink-0 rounded-input border border-subtle"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-body-lg font-semibold break-words">{vendor.name}</h3>
          <dl>
            <dt className="sr-only">Address</dt>
            <dd className="text-body-sm break-words text-secondary">
              <Value value={vendor.address} />
            </dd>
          </dl>
        </div>
        {canManage && (
          <div className="-mt-2 -mr-2 shrink-0">
            <ActionsMenu
              label={`Actions for ${vendor.name}`}
              actions={[{ label: 'Edit vendor', onSelect: (trigger) => onEdit(vendor, trigger) }]}
            />
          </div>
        )}
      </div>
      {/* Under the header, at the card's full width, so a long email has room. */}
      <dl className="flex flex-col gap-1 text-body-sm">
        <div className="flex items-start gap-2">
          <dt>
            <Icon d="M3 6h18v12H3zM3 7l9 6 9-6" />
            <span className="sr-only">Email</span>
          </dt>
          <dd className="min-w-0 break-words">
            <Value value={vendor.email} />
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <dt>
            <Icon d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z" />
            <span className="sr-only">Phone</span>
          </dt>
          <dd className="min-w-0 break-words">
            <Value value={vendor.phone} />
          </dd>
        </div>
      </dl>
    </li>
  );
}
