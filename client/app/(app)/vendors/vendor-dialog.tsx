"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { ApiFailure } from "@/lib/bill-api";
import { createVendor, deleteVendor, removeVendorLogo, updateVendor, uploadVendorLogo } from "@/lib/vendor-api";
import {
  ADDRESS_MAX,
  EMAIL_MAX,
  INVALID_LOGO,
  NAME_MAX,
  VENDOR_FIELDS,
  logoExtension,
  validateVendorInput,
  type VendorErrors,
  type VendorField,
  type VendorInput,
} from "@/lib/vendor-validation";
import { LOGO_FAILED, type Vendor } from "@/lib/vendors";
import { ErrorAlert, Spinner, colorTransition, focusRing, primaryButton } from "@/app/ui";
import { DeleteVendorDialog } from "./delete-vendor-dialog";
import { VendorAvatar } from "./vendor-card";

/** What Save does to the logo: nothing, upload the chosen file, or remove the stored one. */
type LogoChange = { kind: "keep" } | { kind: "file"; file: File; preview: string } | { kind: "remove" };

const FIELDS: { field: VendorField; label: string; type: string; maxLength?: number }[] = [
  { field: "name", label: "Name", type: "text", maxLength: NAME_MAX },
  { field: "email", label: "Email", type: "email", maxLength: EMAIL_MAX },
  { field: "address", label: "Physical Address", type: "text", maxLength: ADDRESS_MAX },
  // No length limit to mirror: the phone rule counts digits.
  { field: "phone", label: "Phone", type: "tel" },
];

// Text and border colours are left to each field, which changes them with its error.
const controlClass = `h-12 w-full rounded-input border bg-background px-4 text-body text-foreground ${colorTransition} ${focusRing}`;

const textButton = `rounded-button text-body-sm font-medium text-secondary underline underline-offset-4 hover:text-foreground disabled:cursor-not-allowed disabled:text-disabled-foreground ${colorTransition} ${focusRing}`;

function sameDetails(input: VendorInput, vendor: Vendor): boolean {
  return VENDOR_FIELDS.every((field) => input[field] === (vendor[field] ?? ""));
}

/**
 * The Edit vendor / Add vendor modal, with the stacked delete confirm. It opens when
 * mounted; the parent unmounts it on onClose. Only managers open it; the routes check again.
 */
export function VendorDialog({
  vendor,
  onClose,
  onSaved,
  onDeleted,
  onGone,
}: {
  /** null: add a vendor. */
  vendor: Vendor | null;
  onClose: () => void;
  /** done false: the fields saved but the logo didn't, so the dialog stays open. */
  onSaved: (vendor: Vendor, action: "saved" | "added", done: boolean) => void;
  onDeleted: (vendor: Vendor) => void;
  /** The vendor was deleted elsewhere (404). */
  onGone: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoButtonRef = useRef<HTMLButtonElement>(null);
  const trashRef = useRef<HTMLButtonElement>(null);
  // Fixed at opening: an add whose logo failed becomes an edit of the new vendor, but its
  // banner still says "Added".
  const [action] = useState<"saved" | "added">(vendor ? "saved" : "added");
  /** The vendor as stored; null until an add saves its fields. */
  const [saved, setSaved] = useState(vendor);
  const [values, setValues] = useState<VendorInput>({
    name: vendor?.name ?? "",
    email: vendor?.email ?? "",
    address: vendor?.address ?? "",
    phone: vendor?.phone ?? "",
  });
  const [errors, setErrors] = useState<VendorErrors>({});
  const [logo, setLogo] = useState<LogoChange>({ kind: "keep" });
  const [logoError, setLogoError] = useState("");
  /** The fields are saved and the logo isn't: Save retries only the logo, unless they change. */
  const [logoPending, setLogoPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const fieldId = (field: VendorField) => `${id}-${field}`;
  const titleId = `${id}-title`;
  const logoErrorId = `${id}-logo-error`;
  const busy = saving || deleting;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Frees a preview once another logo replaces it, or the dialog closes.
  useEffect(() => {
    if (logo.kind !== "file") return;
    const url = logo.preview;
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const shownLogo = logo.kind === "file" ? logo.preview : logo.kind === "remove" ? null : (saved?.logo_url ?? null);

  function change(field: VendorField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared, so choosing the same file again still counts as a change.
    event.target.value = "";
    if (!file) return;
    if (!logoExtension(file)) {
      setLogoError(INVALID_LOGO);
      return;
    }
    setLogoError("");
    setLogo({ kind: "file", file, preview: URL.createObjectURL(file) });
  }

  function removeLogo() {
    setLogoError("");
    setLogo(saved?.logo_url ? { kind: "remove" } : { kind: "keep" });
    // The Remove logo button goes away with the logo.
    logoButtonRef.current?.focus();
  }

  function gone() {
    confirmRef.current?.close();
    dialogRef.current?.close();
    onGone();
  }

  function refused(result: ApiFailure) {
    if (result.status === 404) {
      gone();
    } else if (result.code === "duplicate_vendor_name") {
      setErrors({ name: result.error });
      document.getElementById(fieldId("name"))?.focus();
    } else {
      // 403, 400, 500 or offline: the reply's own message.
      setError(result.error);
    }
  }

  // Fields first, then the logo. The routes check the role and the details again.
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const checked = validateVendorInput(values);
    if ("errors" in checked) {
      setErrors(checked.errors);
      const first = VENDOR_FIELDS.find((field) => checked.errors[field]);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    setErrors({});
    setError("");
    setSaving(true);

    let current: Vendor;
    let fieldsSaved = false;
    if (logoPending && saved && sameDetails(checked.input, saved)) {
      current = saved;
    } else {
      const result = saved
        ? await updateVendor(saved.vendor_id, checked.input)
        : await createVendor(checked.input);
      // null: apiFetch is sending the user to /login.
      if (!result) return;
      if (!result.ok) {
        setSaving(false);
        refused(result);
        return;
      }
      current = result.data;
      fieldsSaved = true;
      // From here a retry edits this vendor: an add never posts twice.
      setSaved(current);
    }

    if (logo.kind !== "keep") {
      const result =
        logo.kind === "file"
          ? await uploadVendorLogo(current.vendor_id, logo.file)
          : await removeVendorLogo(current.vendor_id);
      if (!result) return;
      if (!result.ok) {
        setSaving(false);
        if (result.status === 404) {
          gone();
          return;
        }
        // The card shows the saved fields; the dialog stays open for another try.
        if (fieldsSaved) onSaved(current, action, false);
        setLogoPending(true);
        if (result.code === "invalid_logo") setLogoError(result.error);
        setError(LOGO_FAILED);
        return;
      }
      current = result.data;
    }

    setSaving(false);
    dialogRef.current?.close();
    onSaved(current, action, true);
  }

  async function remove() {
    if (!saved || deleting) return;
    setError("");
    setDeleting(true);
    const result = await deleteVendor(saved.vendor_id);
    if (!result) return;
    setDeleting(false);
    if (result.ok) {
      confirmRef.current?.close();
      dialogRef.current?.close();
      onDeleted(saved);
    } else if (result.status === 404) {
      gone();
    } else {
      // 409 (it has bills), 403 or offline: back to the edit dialog, which says why.
      confirmRef.current?.close();
      setError(result.error);
    }
  }

  function confirmClosed() {
    setConfirming(false);
    // Back on the trash button, unless the edit dialog closed as well.
    if (dialogRef.current?.open) trashRef.current?.focus();
  }

  return (
    <>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        // Esc can't close it while a save or delete is in flight.
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        onClose={onClose}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-card border border-strong bg-overlay p-6 text-foreground shadow-l4 backdrop:bg-background/80 sm:p-8"
      >
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            disabled={busy}
            className={`inline-flex items-center gap-2 rounded-button text-body-lg font-medium text-secondary hover:text-foreground disabled:cursor-not-allowed disabled:text-disabled-foreground ${colorTransition} ${focusRing}`}
          >
            <span aria-hidden="true">←</span>
            <span className="underline underline-offset-4">Back</span>
          </button>
          {saved && (
            <button
              ref={trashRef}
              type="button"
              aria-label="Delete vendor"
              aria-haspopup="dialog"
              onClick={() => {
                setError("");
                setConfirming(true);
              }}
              disabled={busy}
              className={`inline-flex size-10 items-center justify-center rounded-button text-danger hover:bg-raised disabled:cursor-not-allowed disabled:text-disabled-foreground ${colorTransition} ${focusRing}`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="size-5"
              >
                <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />
              </svg>
            </button>
          )}
        </div>

        <h2 id={titleId} className="mt-6 text-heading">
          {saved ? "Edit vendor" : "Add vendor"}
        </h2>

        <form noValidate onSubmit={save} className="mt-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <p className="text-body-sm text-secondary">Logo (optional)</p>
            <div className="flex flex-wrap items-center gap-4">
              <button
                ref={logoButtonRef}
                type="button"
                aria-label="Change logo"
                aria-describedby={logoError ? logoErrorId : undefined}
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className={`group relative shrink-0 rounded-input disabled:cursor-not-allowed ${focusRing}`}
              >
                <VendorAvatar
                  src={shownLogo}
                  className={`size-20 rounded-input border group-hover:border-primary ${logoError ? "border-danger" : "border-strong"}`}
                />
                <span
                  aria-hidden="true"
                  className="absolute -right-2 -bottom-2 flex size-8 items-center justify-center rounded-full border border-strong bg-overlay text-foreground"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-4"
                  >
                    <path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />
                  </svg>
                </span>
              </button>
              {shownLogo && (
                <button type="button" onClick={removeLogo} disabled={busy} className={textButton}>
                  Remove logo
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={chooseLogo}
            />
            {logoError && (
              <p id={logoErrorId} className="text-body-sm text-danger">
                {logoError}
              </p>
            )}
          </div>

          {FIELDS.map(({ field, label, type, maxLength }) => {
            const fieldError = errors[field];
            const errorId = `${fieldId(field)}-error`;
            return (
              <div key={field} className="flex flex-col gap-1">
                <label htmlFor={fieldId(field)} className="text-body-sm text-secondary">
                  {label}
                </label>
                {/* readOnly, not disabled, while saving: the field keeps focus if Enter saved. */}
                <input
                  id={fieldId(field)}
                  type={type}
                  value={values[field]}
                  onChange={(event) => change(field, event.target.value)}
                  maxLength={maxLength}
                  required
                  readOnly={busy}
                  autoComplete="off"
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? errorId : undefined}
                  className={`${controlClass} ${fieldError ? "border-danger" : "border-strong focus-visible:border-primary"}`}
                />
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
            aria-disabled={busy || undefined}
            data-pending={saving || undefined}
            className={`w-full sm:w-auto sm:min-w-40 sm:self-end ${primaryButton}`}
          >
            {saving && <Spinner />}
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      </dialog>
      {/* A sibling, not a child: React passes a child dialog's close and cancel events up
          to this dialog's handlers. */}
      {confirming && saved && (
        <DeleteVendorDialog
          name={saved.name}
          deleting={deleting}
          dialogRef={confirmRef}
          onConfirm={remove}
          onClose={confirmClosed}
        />
      )}
    </>
  );
}
