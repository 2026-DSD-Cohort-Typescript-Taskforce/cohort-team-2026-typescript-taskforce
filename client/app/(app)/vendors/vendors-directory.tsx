"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { loadUserRole } from "@/lib/bill-api";
import { loadVendors } from "@/lib/vendor-api";
import {
  VENDOR_NOT_FOUND,
  canManageVendors,
  filterVendors,
  removeVendor,
  sortVendorsByName,
  upsertVendor,
  vendorBanner,
  type Vendor,
} from "@/lib/vendors";
import {
  ErrorAlert,
  Spinner,
  SuccessAlert,
  colorTransition,
  focusRing,
  primaryButton,
  secondaryButton,
} from "@/app/ui";
import { VendorCard } from "./vendor-card";
import { VendorDialog } from "./vendor-dialog";

const searchClass = `h-12 w-full rounded-input border border-strong bg-background pr-4 pl-11 text-body text-foreground placeholder:text-secondary focus-visible:border-primary ${colorTransition} ${focusRing}`;

const grid = "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3";

/** The load failed: its message and a Retry button. A failed reload keeps the grid shown. */
function LoadError({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <ErrorAlert message={message} />
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        data-pending={retrying || undefined}
        className={secondaryButton}
      >
        {retrying && <Spinner />}
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}

/** Six placeholder cards in the cards' shape while the first load runs. */
function GridSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading vendors…</span>
      <div className={grid}>
        {[0, 1, 2, 3, 4, 5].map((card) => (
          <div
            key={card}
            aria-hidden="true"
            className="flex flex-col gap-4 rounded-card border border-subtle bg-surface p-5 motion-safe:animate-pulse"
          >
            <span className="flex items-start gap-4">
              <span className="size-14 shrink-0 rounded-input bg-raised" />
              <span className="flex flex-1 flex-col gap-2 pt-1">
                <span className="h-5 w-3/5 rounded-input bg-raised" />
                <span className="h-4 w-4/5 rounded-input bg-raised" />
              </span>
            </span>
            <span className="flex flex-col gap-2">
              <span className="h-4 w-2/3 rounded-input bg-raised" />
              <span className="h-4 w-1/2 rounded-input bg-raised" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The vendors grid with search, and for managers the Add / Edit / Delete flows (DC-84). */
export function VendorsDirectory() {
  /** null until the first load succeeds. */
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  /** null while the role loads; false if it can't manage vendors or didn't load. */
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [banner, setBanner] = useState("");
  const [error, setError] = useState("");
  /** The open dialog: the vendor to edit, or null to add one. */
  const [dialog, setDialog] = useState<{ vendor: Vendor | null } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The ⋮ or Add button that opened the dialog, which gets focus back when it closes.
  const openerRef = useRef<HTMLButtonElement | null>(null);
  // Only the newest load's answer is shown, if reloads overlap.
  const latest = useRef(0);
  const searchId = useId();
  const headingId = useId();

  const load = useCallback(() => {
    const request = ++latest.current;
    loadVendors().then((result) => {
      // null: apiFetch is sending the user to /login.
      if (!result || request !== latest.current) return;
      if (result.ok) {
        setVendors(sortVendorsByName(result.data));
        setLoadError("");
      } else {
        setLoadError(result.error);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Never assumed: ⋮ and Add stay hidden until the role says the user can manage vendors.
  useEffect(() => {
    let active = true;
    loadUserRole().then((result) => {
      if (active && result) setCanManage(result.ok && canManageVendors(result.data));
    });
    return () => {
      active = false;
    };
  }, []);

  function reload() {
    setLoading(true);
    load();
  }

  function clearSearch() {
    setQuery("");
    searchRef.current?.focus();
  }

  function openDialog(vendor: Vendor | null, opener: HTMLButtonElement) {
    // Cleared now, so the outcome of this dialog is announced even if it repeats the last one.
    setBanner("");
    setError("");
    openerRef.current = opener;
    setDialog({ vendor });
  }

  function closeDialog() {
    setDialog(null);
    const opener = openerRef.current;
    openerRef.current = null;
    if (!opener) return;
    // A card the search no longer matches has taken its ⋮ with it.
    if (opener.isConnected) opener.focus();
    else headingRef.current?.focus();
  }

  // The ⋮ that opened the dialog goes with its card (or with the reload), so focus moves
  // to the heading.
  function focusHeading() {
    openerRef.current = null;
    headingRef.current?.focus();
  }

  function saved(vendor: Vendor, action: "saved" | "added", done: boolean) {
    // Committed now, so closeDialog sees whether the card is still in the grid.
    flushSync(() => {
      setVendors((current) => current && upsertVendor(current, vendor));
      if (done) setBanner(vendorBanner(action, vendor.name));
    });
  }

  function deleted(vendor: Vendor) {
    setVendors((current) => current && removeVendor(current, vendor.vendor_id));
    setBanner(vendorBanner("deleted", vendor.name));
    focusHeading();
  }

  function gone() {
    setError(VENDOR_NOT_FOUND.body.error);
    reload();
    focusHeading();
  }

  let content: ReactNode;
  if (!vendors) {
    content = loadError ? <LoadError message={loadError} retrying={loading} onRetry={reload} /> : <GridSkeleton />;
  } else {
    const shown = filterVendors(vendors, query);
    let cards: ReactNode;
    if (vendors.length === 0) {
      cards = (
        <div className="rounded-card border border-subtle bg-surface p-6 sm:p-8">
          <p className="text-body-lg font-medium">No vendors yet.</p>
        </div>
      );
    } else if (shown.length === 0) {
      cards = (
        <div className="flex flex-col items-start gap-4 rounded-card border border-subtle bg-surface p-6">
          <p className="text-body break-words text-secondary">{`No vendors match "${query.trim()}".`}</p>
          <button type="button" onClick={clearSearch} className={secondaryButton}>
            Clear
          </button>
        </div>
      );
    } else {
      cards = (
        <ul className={grid}>
          {shown.map((vendor) => (
            <VendorCard
              key={vendor.vendor_id}
              vendor={vendor}
              canManage={canManage === true}
              onEdit={openDialog}
            />
          ))}
        </ul>
      );
    }

    content = (
      <div className="flex flex-col gap-6">
        {loadError && <LoadError message={loadError} retrying={loading} onRetry={reload} />}
        {vendors.length > 0 && (
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">
              Search vendors
            </label>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-secondary"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search vendors by name, address, email or phone number"
              autoComplete="off"
              className={searchClass}
            />
          </div>
        )}
        <section aria-labelledby={headingId} className="flex flex-col gap-4">
          {/* tabIndex -1: takes focus when the card whose ⋮ had it goes away. */}
          <h2 ref={headingRef} id={headingId} tabIndex={-1} className="text-subheading outline-none">
            All Vendors ({vendors.length})
          </h2>
          {cards}
        </section>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-heading">Vendors</h1>
        {/* Hidden until the role and the list have both loaded. */}
        {canManage && vendors && (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={(event) => openDialog(null, event.currentTarget)}
            className={primaryButton}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
              className="size-5"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Vendor
          </button>
        )}
      </div>
      {/* The alerts bring their own margin, so no gap is left while they are empty. */}
      <div className="flex flex-col">
        <div className="relative">
          <SuccessAlert message={banner} className="mb-6 pr-12" />
          {banner && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                setBanner("");
                headingRef.current?.focus();
              }}
              className={`absolute top-1 right-1 inline-flex size-8 items-center justify-center rounded-button text-success-foreground hover:bg-success-border ${colorTransition} ${focusRing}`}
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                aria-hidden="true"
                className="size-4"
              >
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          )}
        </div>
        <ErrorAlert message={error} className="mb-6" />
        {content}
      </div>
      {dialog && (
        <VendorDialog
          key={dialog.vendor?.vendor_id ?? "new"}
          vendor={dialog.vendor}
          onClose={closeDialog}
          onSaved={saved}
          onDeleted={deleted}
          onGone={gone}
        />
      )}
    </>
  );
}
