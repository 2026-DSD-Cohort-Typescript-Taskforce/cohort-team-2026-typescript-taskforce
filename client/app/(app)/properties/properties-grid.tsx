'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Property } from '@/lib/properties';
import { loadProperties } from '@/lib/property-api';
import { ErrorAlert, SuccessAlert, colorTransition, focusRing, primaryButton } from '@/app/ui';
import { LoadError } from '../bills/bills-list';
import { PropertyDialog } from './property-dialog';

const byName = (a: Property, b: Property) => a.name.localeCompare(b.name);

/** Every property as a card, with create, edit and delete in a modal (DC-83). */
export function PropertiesGrid() {
  /** null until the first load succeeds. */
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  /** "new" for the create modal, a property for its edit modal. */
  const [open, setOpen] = useState<Property | 'new' | null>(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The button that opened the modal, which gets focus back when it closes.
  const openerRef = useRef<HTMLButtonElement | null>(null);
  // Only the newest load's answer is shown, if reloads overlap.
  const latest = useRef(0);

  const load = useCallback(() => {
    const request = ++latest.current;
    loadProperties().then((result) => {
      // null: apiFetch is sending the user to /login.
      if (!result || request !== latest.current) return;
      if (result.ok) {
        setProperties(result.data);
        setLoadError('');
      } else {
        setLoadError(result.error);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function reload() {
    setLoading(true);
    load();
  }

  function openDialog(target: Property | 'new', opener: HTMLButtonElement) {
    // Cleared now, so the outcome is announced even if it repeats the last one.
    setSuccess('');
    setError('');
    openerRef.current = opener;
    setOpen(target);
  }

  function closeDialog() {
    setOpen(null);
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }

  // The card's ⋮ button goes with the card, so focus moves to the heading.
  function focusHeading() {
    openerRef.current = null;
    headingRef.current?.focus();
  }

  function saved(property: Property, created: boolean) {
    setProperties((current) =>
      [...(current ?? []).filter((p) => p.property_id !== property.property_id), property].sort(
        byName,
      ),
    );
    setSuccess(created ? `Created ${property.name}.` : `Saved ${property.name}.`);
  }

  function deleted(property: Property) {
    setProperties(
      (current) => current?.filter((p) => p.property_id !== property.property_id) ?? current,
    );
    setSuccess(`Deleted ${property.name}.`);
    focusHeading();
  }

  function gone(message: string) {
    setError(message);
    reload();
    focusHeading();
  }

  let content: ReactNode;
  if (!properties) {
    content = loadError ? (
      <LoadError message={loadError} retrying={loading} onRetry={reload} />
    ) : (
      <p role="status" className="text-body text-secondary">
        Loading properties…
      </p>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        {/* A failed reload keeps the grid shown. */}
        {loadError && <LoadError message={loadError} retrying={loading} onRetry={reload} />}
        {properties.length === 0 ? (
          <div className="rounded-card border border-subtle bg-surface p-6 sm:p-8">
            <p className="text-body-lg font-medium">No properties yet. Add one to get started.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {properties.map((property) => (
              <PropertyCard
                key={property.property_id}
                property={property}
                onEdit={(opener) => openDialog(property, opener)}
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* tabIndex -1: takes focus after a delete removes the card whose button had it. */}
        <h1 ref={headingRef} tabIndex={-1} className="text-heading outline-none">
          Properties
        </h1>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={(event) => openDialog('new', event.currentTarget)}
          className={primaryButton}
        >
          Add property
        </button>
      </div>
      {/* The alerts bring their own margin, so no gap is left while they are empty. */}
      <div className="flex flex-col">
        <SuccessAlert message={success} className="mb-6" />
        <ErrorAlert message={error} className="mb-6" />
        {content}
      </div>
      {open && (
        <PropertyDialog
          key={open === 'new' ? 'new' : open.property_id}
          property={open === 'new' ? null : open}
          onClose={closeDialog}
          onSaved={saved}
          onDeleted={deleted}
          onGone={gone}
        />
      )}
    </>
  );
}

function PropertyCard({
  property,
  onEdit,
}: {
  property: Property;
  onEdit: (opener: HTMLButtonElement) => void;
}) {
  return (
    <li className="flex flex-col overflow-hidden rounded-card border border-subtle bg-surface">
      {/* Placeholder until properties have images. */}
      <div
        aria-hidden="true"
        className="flex aspect-video items-center justify-center bg-raised text-secondary"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-12"
        >
          <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4" />
        </svg>
      </div>
      <div className="flex items-start gap-2 p-5">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="text-subheading break-words">{property.name}</h2>
          <dl className="flex flex-col gap-1 text-body-sm text-secondary">
            <Detail label="Address" value={property.address ?? 'No address'} />
            {property.email && <Detail label="Email" value={property.email} />}
            {property.phone && <Detail label="Phone" value={property.phone} />}
          </dl>
        </div>
        <button
          type="button"
          aria-label={`Edit ${property.name}`}
          aria-haspopup="dialog"
          onClick={(event) => onEdit(event.currentTarget)}
          className={`-mt-1 -mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-button text-secondary hover:bg-overlay hover:text-foreground ${colorTransition} ${focusRing}`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-5">
            <circle cx="12" cy="5" r="1.75" />
            <circle cx="12" cy="12" r="1.75" />
            <circle cx="12" cy="19" r="1.75" />
          </svg>
        </button>
      </div>
    </li>
  );
}

// The card shows values only; the labels are for screen readers.
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
