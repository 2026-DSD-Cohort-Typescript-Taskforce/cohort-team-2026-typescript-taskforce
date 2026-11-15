"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { savePolicy } from "@/lib/policy-api";
import type { Policy, PolicyVendor } from "@/lib/policies";
import {
  POLICY_FIELDS,
  POLICY_NAME_MAX,
  POLICY_TEXT_MAX,
  validatePolicyInput,
  type PolicyErrors,
  type PolicyField,
} from "@/lib/policy-validation";
import { ErrorAlert, Spinner, colorTransition, focusRing, primaryButton } from "@/app/ui";

// Text and border colours are left to each field, which changes them with its error.
const controlClass = `w-full rounded-input border bg-background px-4 text-body text-foreground placeholder:text-secondary ${colorTransition} ${focusRing}`;

/**
 * The "Edit Policy Details" modal, for a new policy and an existing one. It opens when
 * mounted; the parent unmounts it on onClose, which never comes while a save runs.
 * Only managers open it; the routes check again.
 */
export function PolicyDialog({
  vendor,
  onClose,
  onSaved,
  onGone,
}: {
  vendor: PolicyVendor;
  onClose: () => void;
  onSaved: (vendorId: number, policy: Policy) => void;
  /** The vendor (or its policy) was deleted elsewhere (404); the message is the reply's. */
  onGone: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<Record<PolicyField, string>>({
    name: vendor.policy?.name ?? "",
    description: vendor.policy?.description ?? "",
  });
  const [errors, setErrors] = useState<PolicyErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // busy as a ref too, set at once: the close guards read it, and a dialog closed straight
  // after a save ends must not see the value from the last render.
  const busyRef = useRef(false);
  /** The focused element, for when a close request has to be undone. */
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const id = useId();
  const fieldId = (field: PolicyField) => `${id}-${field}`;
  const titleId = `${id}-title`;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Chrome honours one cancel preventDefault per user activation, so a second Esc would
  // close a saving dialog: Esc is stopped at keydown instead, wherever focus is.
  useEffect(() => {
    function holdEsc(event: KeyboardEvent) {
      if (event.key === "Escape" && busyRef.current) event.preventDefault();
    }
    window.addEventListener("keydown", holdEsc, true);
    return () => window.removeEventListener("keydown", holdEsc, true);
  }, []);

  function setBusy(value: boolean) {
    busyRef.current = value;
    setSaving(value);
  }

  // Another kind of close request (a back gesture) can still close a saving dialog. It is
  // shown again, with focus where it was, and the parent isn't told.
  function showAgain() {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected) return;
    dialog.showModal();
    lastFocusRef.current?.focus();
  }

  function change(field: PolicyField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const checked = validatePolicyInput(values);
    if ("errors" in checked) {
      setErrors(checked.errors);
      // An earlier reply's message (a 403, offline) would read as part of these.
      setError("");
      const first = POLICY_FIELDS.find((field) => checked.errors[field]);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    setErrors({});
    setError("");
    setBusy(true);

    const result = await savePolicy(vendor.vendor_id, checked.input);
    // null: apiFetch is sending the user to /login.
    if (!result) return;
    setBusy(false);
    if (result.ok) {
      dialogRef.current?.close();
      onSaved(vendor.vendor_id, result.data);
    } else if (result.status === 404) {
      dialogRef.current?.close();
      onGone(result.error);
    } else {
      // 403, 400, 500 or offline: the reply's own message.
      setError(result.error);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onFocus={(event) => {
        lastFocusRef.current = event.target as HTMLElement;
      }}
      // A first close request of another kind; Esc is already stopped at keydown.
      onCancel={(event) => {
        if (busyRef.current) event.preventDefault();
      }}
      onClose={() => {
        if (busyRef.current) showAgain();
        else onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-card border border-strong bg-overlay p-6 text-foreground shadow-l4 backdrop:bg-background/80 sm:p-8"
    >
      <button
        type="button"
        onClick={() => dialogRef.current?.close()}
        disabled={saving}
        className={`inline-flex items-center gap-2 rounded-button text-body-lg font-medium text-secondary hover:text-foreground disabled:cursor-not-allowed disabled:text-disabled-foreground ${colorTransition} ${focusRing}`}
      >
        <span aria-hidden="true">←</span>
        <span className="underline underline-offset-4">Cancel</span>
      </button>

      <h2 id={titleId} className="mt-6 text-heading">
        Edit Policy Details
      </h2>
      <p className="mt-1 text-body break-words text-secondary">{vendor.name}</p>

      <form noValidate onSubmit={save} className="mt-6 flex flex-col gap-5">
        {POLICY_FIELDS.map((field) => {
          const fieldError = errors[field];
          const errorId = `${fieldId(field)}-error`;
          const shared = {
            id: fieldId(field),
            value: values[field],
            required: true,
            // readOnly, not disabled, while saving: the field keeps focus if Enter saved.
            readOnly: saving,
            autoComplete: "off",
            "aria-invalid": fieldError ? (true as const) : undefined,
            "aria-describedby": fieldError ? errorId : undefined,
            className: `${controlClass} ${fieldError ? "border-danger" : "border-strong focus-visible:border-primary"}`,
          };
          return (
            <div key={field} className="flex flex-col gap-1">
              <label htmlFor={fieldId(field)} className="text-body-sm text-secondary">
                {field === "name" ? "Policy Name" : "Policy"}
              </label>
              {field === "name" ? (
                <input
                  {...shared}
                  type="text"
                  maxLength={POLICY_NAME_MAX}
                  placeholder="Name Your Policy"
                  onChange={(event) => change(field, event.target.value)}
                  className={`h-12 ${shared.className}`}
                />
              ) : (
                <textarea
                  {...shared}
                  rows={5}
                  maxLength={POLICY_TEXT_MAX}
                  placeholder="Describe Your Policy Here."
                  onChange={(event) => change(field, event.target.value)}
                  className={`py-3 ${shared.className}`}
                />
              )}
              {fieldError && (
                <p id={errorId} className="text-body-sm text-danger">
                  {fieldError}
                </p>
              )}
            </div>
          );
        })}

        <ErrorAlert message={error} />
        {/* aria-disabled, not disabled, while saving: the button keeps focus, so a failed
            save leaves the user on it. save() ignores the click. */}
        <button
          type="submit"
          aria-disabled={saving || undefined}
          data-pending={saving || undefined}
          className={`w-full sm:w-auto sm:min-w-40 sm:self-end ${primaryButton}`}
        >
          {saving && <Spinner />}
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
    </dialog>
  );
}
