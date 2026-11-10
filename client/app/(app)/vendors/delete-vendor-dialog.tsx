"use client";

import { useEffect, useId, useRef, type RefObject } from "react";
import { Spinner, colorTransition, focusRing, secondaryButton } from "@/app/ui";

// Dark text on the bright red: white on it is under 4.5:1.
const dangerButton = `inline-flex h-12 items-center justify-center gap-2 rounded-button bg-danger-bright px-6 text-body font-semibold text-on-primary hover:bg-danger data-pending:cursor-wait data-pending:bg-danger-bright ${colorTransition} ${focusRing}`;

/**
 * "Delete {name}?", stacked over the edit dialog. It opens when mounted and the parent
 * unmounts it on onClose. The parent runs the delete.
 */
export function DeleteVendorDialog({
  name,
  deleting,
  dialogRef,
  onConfirm,
  onClose,
}: {
  name: string;
  deleting: boolean;
  /** Shared with the parent, which closes the dialog when the delete ends. */
  dialogRef: RefObject<HTMLDialogElement | null>;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const textId = useId();

  useEffect(() => {
    dialogRef.current?.showModal();
    // React's autoFocus runs before showModal(), while the dialog is still hidden, so
    // Cancel (the safe choice) is focused here instead.
    cancelRef.current?.focus();
  }, [dialogRef]);

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={textId}
      // Esc can't close it while the delete is in flight.
      onCancel={(event) => {
        if (deleting) event.preventDefault();
      }}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-strong bg-overlay p-6 text-foreground shadow-l4 backdrop:bg-background/80 sm:p-8"
    >
      <h2 id={titleId} className="text-subheading break-words">
        Delete {name}?
      </h2>
      <p id={textId} className="mt-2 text-body text-secondary">
        This can&apos;t be undone.
      </p>
      <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:justify-end">
        <button
          ref={cancelRef}
          type="button"
          onClick={() => dialogRef.current?.close()}
          disabled={deleting}
          className={secondaryButton}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          aria-disabled={deleting || undefined}
          data-pending={deleting || undefined}
          className={dangerButton}
        >
          {deleting && <Spinner />}
          {deleting ? "Deleting…" : "Delete vendor"}
        </button>
      </div>
    </dialog>
  );
}
