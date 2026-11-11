"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { loadUserRole } from "@/lib/bill-api";
import { loadPolicyVendors, setPolicyActive } from "@/lib/policy-api";
import {
  NOT_APPLIED_NOTICE,
  canManagePolicies,
  filterPolicyVendors,
  policyBanner,
  replacePolicy,
  type Policy,
  type PolicyVendor,
} from "@/lib/policies";
import { ErrorAlert, Spinner, SuccessAlert, colorTransition, focusRing, secondaryButton } from "@/app/ui";
import { PolicyDialog } from "./policy-dialog";
import { PolicyRow } from "./policy-row";

const searchClass = `h-12 w-full rounded-input border border-strong bg-background pr-4 pl-11 text-body text-foreground placeholder:text-secondary focus-visible:border-primary ${colorTransition} ${focusRing}`;

/** The load failed: its message and a Retry button. A failed reload keeps the rows shown. */
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

/** Six placeholder rows in the rows' shape while the first load runs. */
function RowsSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading policies…</span>
      <div className="flex flex-col gap-4">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div
            key={row}
            aria-hidden="true"
            className="flex items-start gap-4 rounded-card border border-subtle bg-surface p-5 motion-safe:animate-pulse"
          >
            <span className="size-5 shrink-0 rounded-input bg-raised" />
            <span className="h-5 w-1/4 rounded-input bg-raised" />
            <span className="flex flex-1 flex-col gap-2">
              <span className="h-4 w-1/4 rounded-input bg-raised" />
              <span className="h-5 w-1/2 rounded-input bg-raised" />
              <span className="h-4 w-3/4 rounded-input bg-raised" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The vendors with their policies: search, on/off checkboxes, and the Add / Edit modal (DC-85). */
export function PoliciesList() {
  /** null until the first load succeeds. */
  const [vendors, setVendors] = useState<PolicyVendor[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  /** null while the role loads; false if it can't manage policies or didn't load. */
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [banner, setBanner] = useState("");
  const [error, setError] = useState("");
  /** Vendors whose on/off change is being saved. */
  const [saving, setSaving] = useState<Set<number>>(() => new Set());
  /** The open dialog: the vendor as it was when the modal opened. */
  const [dialog, setDialog] = useState<{ vendor: PolicyVendor } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The ⋮ that opened the dialog, which gets focus back when it closes.
  const openerRef = useRef<HTMLButtonElement | null>(null);
  // Only the newest load's answer is shown, if reloads overlap.
  const latest = useRef(0);
  const searchId = useId();
  const headingId = useId();

  const load = useCallback(() => {
    const request = ++latest.current;
    loadPolicyVendors().then((result) => {
      // null: apiFetch is sending the user to /login.
      if (!result || request !== latest.current) return;
      if (result.ok) {
        setVendors(result.data);
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

  // Never assumed: the checkboxes and ⋮ stay disabled or hidden until the role says the user
  // can manage policies, and stay that way if it can't be loaded.
  useEffect(() => {
    let active = true;
    loadUserRole().then((result) => {
      if (active && result) setCanManage(result.ok && canManagePolicies(result.data));
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

  function openDialog(vendor: PolicyVendor, opener: HTMLButtonElement) {
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
    // A row the search no longer matches has taken its ⋮ with it.
    if (opener.isConnected) opener.focus();
    else headingRef.current?.focus();
  }

  function saved(vendorId: number, policy: Policy) {
    const vendor = dialog?.vendor;
    // Committed now, so closeDialog sees whether the row is still in the list.
    flushSync(() => {
      setVendors((current) => current && replacePolicy(current, vendorId, policy));
      if (vendor) setBanner(vendor.policy ? policyBanner("updated", "") : policyBanner("added", vendor.name));
    });
  }

  function gone(message: string) {
    setError(message);
    reload();
    openerRef.current = null;
    headingRef.current?.focus();
  }

  async function toggle(vendor: PolicyVendor, next: boolean) {
    const previous = vendor.policy;
    if (!previous) return;
    const id = vendor.vendor_id;
    setBanner("");
    setError("");
    setVendors((current) => current && replacePolicy(current, id, { ...previous, is_active: next }));
    setSaving((current) => new Set(current).add(id));

    const result = await setPolicyActive(id, next);
    setSaving((current) => {
      const rest = new Set(current);
      rest.delete(id);
      return rest;
    });
    // null: apiFetch is sending the user to /login.
    if (!result) return;
    if (result.ok) {
      setVendors((current) => current && replacePolicy(current, id, result.data));
      setBanner(policyBanner(next ? "on" : "off", result.data.name));
      return;
    }
    // Back to what it was.
    setVendors((current) => current && replacePolicy(current, id, previous));
    setError(result.error);
    if (result.status === 404) reload();
  }

  let content: ReactNode;
  if (!vendors) {
    content = loadError ? <LoadError message={loadError} retrying={loading} onRetry={reload} /> : <RowsSkeleton />;
  } else {
    const shown = filterPolicyVendors(vendors, query);
    let rows: ReactNode;
    if (vendors.length === 0) {
      rows = <p className="p-6 text-body-lg font-medium sm:p-8">No vendors yet.</p>;
    } else if (shown.length === 0) {
      rows = (
        <div className="flex flex-col items-start gap-4 p-6">
          <p className="text-body break-words text-secondary">{`No vendors match "${query.trim()}".`}</p>
          <button type="button" onClick={clearSearch} className={secondaryButton}>
            Clear
          </button>
        </div>
      );
    } else {
      rows = (
        <ul className="divide-y divide-subtle">
          {shown.map((vendor) => (
            <PolicyRow
              key={vendor.vendor_id}
              vendor={vendor}
              canManage={canManage === true}
              roleKnown={canManage !== null}
              saving={saving.has(vendor.vendor_id)}
              onToggle={toggle}
              onEdit={openDialog}
            />
          ))}
        </ul>
      );
    }

    content = (
      <div className="flex flex-col gap-6">
        {loadError && <LoadError message={loadError} retrying={loading} onRetry={reload} />}
        <section
          aria-labelledby={headingId}
          className="overflow-hidden rounded-card border border-subtle bg-surface"
        >
          <div className="flex flex-col gap-4 border-b border-subtle p-4 sm:p-5">
            {/* tabIndex -1: takes focus when the row whose ⋮ had it goes away. */}
            <h2 ref={headingRef} id={headingId} tabIndex={-1} className="text-subheading outline-none">
              Vendors ({vendors.length})
            </h2>
            {vendors.length > 0 && (
              <div className="relative">
                <label htmlFor={searchId} className="sr-only">
                  Search policies
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
                  placeholder="Search vendors or policies"
                  autoComplete="off"
                  className={searchClass}
                />
              </div>
            )}
          </div>
          {rows}
        </section>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-heading">Policies</h1>
        <p className="text-body-sm text-secondary">{NOT_APPLIED_NOTICE}</p>
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
        <PolicyDialog
          key={dialog.vendor.vendor_id}
          vendor={dialog.vendor}
          onClose={closeDialog}
          onSaved={saved}
          onGone={gone}
        />
      )}
    </>
  );
}
