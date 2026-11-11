"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { checkboxLabel, paymentLine, type PolicyVendor } from "@/lib/policies";
import { colorTransition, focusRing } from "@/app/ui";

/**
 * One vendor and its policy. Managers get a checkbox that switches the policy on or off and
 * a ⋮ menu with "Edit policy" / "Add policy". Below sm the policy block drops to its own line.
 */
export function PolicyRow({
  vendor,
  canManage,
  roleKnown,
  saving,
  onToggle,
  onEdit,
}: {
  vendor: PolicyVendor;
  /** The user can change policies. */
  canManage: boolean;
  /** The role has finished loading (a failed load counts: the page is then read-only). */
  roleKnown: boolean;
  saving: boolean;
  onToggle: (vendor: PolicyVendor, next: boolean) => void;
  /** The trigger is the ⋮ button, which gets focus back when the dialog closes. */
  onEdit: (vendor: PolicyVendor, trigger: HTMLButtonElement) => void;
}) {
  const { policy } = vendor;
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const triggerId = useId();
  const menuId = useId();
  const payment = paymentLine(vendor);

  useEffect(() => {
    if (!menuOpen) return;
    itemRef.current?.focus();
    // click, not pointerdown: by then a click on a field has moved focus there, and a click
    // on nothing focusable has left it on the body, which is when it goes back to the ⋮.
    function closeOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
      if (document.activeElement === document.body) triggerRef.current?.focus();
    }
    document.addEventListener("click", closeOutside);
    return () => document.removeEventListener("click", closeOutside);
  }, [menuOpen]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "Tab") {
      setMenuOpen(false);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      // One item: the arrows keep focus on it rather than scrolling the page.
      event.preventDefault();
      itemRef.current?.focus();
    }
  }

  function edit() {
    setMenuOpen(false);
    if (triggerRef.current) onEdit(vendor, triggerRef.current);
  }

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,2fr)_auto] sm:p-5">
      <input
        type="checkbox"
        checked={policy?.is_active ?? false}
        disabled={!policy || !roleKnown || !canManage}
        // aria-disabled, not disabled, while saving: disabled would drop focus to the body.
        aria-disabled={saving || undefined}
        aria-label={checkboxLabel(vendor)}
        onChange={(event) => {
          if (!saving) onToggle(vendor, event.target.checked);
        }}
        className="mt-1 size-5 shrink-0 accent-primary disabled:cursor-not-allowed aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      />
      <h3 className="mt-0.5 min-w-0 text-body-lg font-semibold break-words">{vendor.name}</h3>
      <div className="col-span-3 row-start-2 flex min-w-0 flex-col gap-1 sm:col-span-1 sm:col-start-3 sm:row-start-1">
        {policy ? (
          <>
            <p className="text-body-sm text-secondary">{policy.is_active ? "Active policy" : "Inactive policy"}</p>
            <p className="font-medium break-words">{policy.name}</p>
            <p className="line-clamp-2 text-body-sm break-words text-secondary">{policy.description}</p>
          </>
        ) : (
          <p className="text-body-sm text-secondary">No policy yet.</p>
        )}
        {payment && (
          <a
            href={vendor.payment_portal_url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={`w-fit max-w-full rounded-input text-body-sm break-words text-primary underline underline-offset-4 hover:text-primary-hover ${colorTransition} ${focusRing}`}
          >
            {payment} <span aria-hidden="true">↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
      {roleKnown && canManage && (
        <div className="relative -mt-2 -mr-2 shrink-0 sm:col-start-4 sm:row-start-1">
          <button
            ref={triggerRef}
            id={triggerId}
            type="button"
            aria-label={`Actions for ${vendor.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            onClick={() => setMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setMenuOpen(true);
              }
            }}
            className={`inline-flex size-10 items-center justify-center rounded-button text-secondary hover:bg-raised hover:text-foreground ${colorTransition} ${focusRing}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-5">
              <circle cx="12" cy="5" r="1.75" />
              <circle cx="12" cy="12" r="1.75" />
              <circle cx="12" cy="19" r="1.75" />
            </svg>
          </button>
          {menuOpen && (
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-labelledby={triggerId}
              onKeyDown={onMenuKeyDown}
              className="absolute top-full right-0 z-10 mt-1 min-w-40 rounded-input border border-strong bg-overlay p-1 shadow-l4"
            >
              <button
                ref={itemRef}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={edit}
                className={`flex w-full items-center rounded-input px-3 py-2 text-left text-body-sm whitespace-nowrap text-foreground hover:bg-raised focus-visible:bg-raised ${colorTransition} ${focusRing}`}
              >
                {policy ? "Edit policy" : "Add policy"}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
