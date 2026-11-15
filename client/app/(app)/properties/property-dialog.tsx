'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import {
  validateProperty,
  type Property,
  type PropertyErrors,
  type PropertyField,
} from '@/lib/property-validation';
import { createProperty, deleteProperty, updateProperty } from '@/lib/property-api';
import {
  ErrorAlert,
  Spinner,
  colorTransition,
  focusRing,
  primaryButton,
  secondaryButton,
} from '@/app/ui';

const inputClass = `h-12 w-full rounded-input border border-strong bg-background px-4 text-body text-foreground placeholder:text-secondary focus-visible:border-primary aria-invalid:border-danger disabled:cursor-not-allowed disabled:text-disabled-foreground ${colorTransition} ${focusRing}`;

const dangerButton = `inline-flex h-12 items-center justify-center gap-2 rounded-button border border-danger px-6 text-body font-semibold text-danger hover:bg-error-surface disabled:cursor-not-allowed disabled:border-subtle disabled:text-disabled-foreground data-pending:cursor-wait ${colorTransition} ${focusRing}`;

const FIELDS: { field: PropertyField; label: string; type: string; autoComplete: string }[] = [
  { field: 'name', label: 'Name', type: 'text', autoComplete: 'organization' },
  { field: 'address', label: 'Address', type: 'text', autoComplete: 'street-address' },
  { field: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { field: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
];

type Busy = 'save' | 'delete' | null;

/**
 * The create modal (property null) or the edit modal for one property, with delete.
 * It opens when mounted; the parent unmounts it on onClose.
 */
export function PropertyDialog({
  property,
  onClose,
  onSaved,
  onDeleted,
  onGone,
}: {
  property: Property | null;
  onClose: () => void;
  onSaved: (property: Property, created: boolean) => void;
  onDeleted: (property: Property) => void;
  /** 404: it was deleted by someone else. */
  onGone: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const [values, setValues] = useState<Record<PropertyField, string>>({
    name: property?.name ?? '',
    address: property?.address ?? '',
    email: property?.email ?? '',
    phone: property?.phone ?? '',
  });
  const [errors, setErrors] = useState<PropertyErrors>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  const confirmId = useId();
  const fieldId = useId();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const title = property ? `Edit ${property.name}` : 'Add property';

  function change(field: PropertyField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  // The server checks the details again.
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const result = validateProperty(values);
    if (!result.input) {
      setErrors(result.errors);
      // Focus the first field that failed, so the user lands on its message.
      const first = FIELDS.find(({ field }) => result.errors[field]);
      if (first) document.getElementById(`${fieldId}-${first.field}`)?.focus();
      return;
    }
    setError('');
    setBusy('save');
    const saved = property
      ? await updateProperty(property.property_id, result.input)
      : await createProperty(result.input);
    // null: apiFetch is sending the user to /login.
    if (!saved) return;
    setBusy(null);
    if (saved.ok) {
      dialogRef.current?.close();
      onSaved(saved.data, !property);
    } else if (saved.status === 404) {
      dialogRef.current?.close();
      onGone(saved.error);
    } else {
      setError(saved.error);
    }
  }

  async function remove() {
    if (!property || busy) return;
    setError('');
    setBusy('delete');
    const result = await deleteProperty(property.property_id);
    if (!result) return;
    if (result.ok || result.status === 404) {
      // Either way it's gone from the grid.
      setBusy(null);
      dialogRef.current?.close();
      onDeleted(property);
      return;
    }
    // 409: bills or users still use it. The message says so; nothing was deleted. flushSync
    // re-enables the Delete property button first, so it can take focus from the closed panel.
    flushSync(() => {
      setBusy(null);
      setConfirming(false);
      setError(result.error);
    });
    deleteRef.current?.focus();
  }

  function cancelDelete() {
    setConfirming(false);
    deleteRef.current?.focus();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Esc can't close it while a save or delete is running.
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={onClose}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-card border border-strong bg-overlay p-6 text-foreground shadow-l4 backdrop:bg-background/80 sm:p-8"
    >
      <h2 id={titleId} className="text-subheading break-words sm:text-heading">
        {title}
      </h2>

      <form onSubmit={save} noValidate className="mt-6 flex flex-col gap-4">
        <fieldset disabled={busy !== null} className="flex min-w-0 flex-col gap-4">
          <legend className="sr-only">Property details</legend>
          {FIELDS.map(({ field, label, type, autoComplete }) => {
            const id = `${fieldId}-${field}`;
            const message = errors[field];
            return (
              <div key={field} className="flex flex-col gap-1">
                <label htmlFor={id} className="text-body-sm text-secondary">
                  {label}
                  {field !== 'name' && ' (optional)'}
                </label>
                <input
                  id={id}
                  type={type}
                  autoComplete={autoComplete}
                  required={field === 'name'}
                  value={values[field]}
                  onChange={(event) => change(field, event.target.value)}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? `${id}-error` : undefined}
                  className={inputClass}
                />
                {message && (
                  <p id={`${id}-error`} className="text-caption font-semibold text-danger">
                    {message}
                  </p>
                )}
              </div>
            );
          })}
        </fieldset>

        <ErrorAlert message={error} />

        {confirming && property && (
          <div
            role="group"
            aria-labelledby={confirmId}
            className="flex flex-col gap-3 rounded-input border border-error-border bg-error-surface p-4"
          >
            <p id={confirmId} className="text-body text-error-foreground">
              Delete {property.name}? This can&apos;t be undone.
            </p>
            <div className="flex flex-wrap gap-3">
              {/* Focused first, so Enter right away doesn't delete. */}
              <button
                type="button"
                autoFocus
                onClick={cancelDelete}
                disabled={busy !== null}
                className={secondaryButton}
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={busy === 'save'}
                aria-disabled={busy === 'delete' || undefined}
                data-pending={busy === 'delete' || undefined}
                className={dangerButton}
              >
                {busy === 'delete' && <Spinner />}
                {busy === 'delete' ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          {property && (
            <button
              ref={deleteRef}
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy !== null}
              aria-expanded={confirming}
              className={dangerButton}
            >
              Delete property
            </button>
          )}
          <div className="flex flex-col-reverse gap-3 sm:ml-auto sm:flex-row">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              disabled={busy !== null}
              className={secondaryButton}
            >
              Cancel
            </button>
            {/* aria-disabled, not disabled, while saving: the button keeps focus, so a failed
                save leaves the user on it. save() ignores the click. */}
            <button
              type="submit"
              disabled={busy === 'delete'}
              aria-disabled={busy === 'save' || undefined}
              data-pending={busy === 'save' || undefined}
              className={primaryButton}
            >
              {busy === 'save' && <Spinner />}
              {busy === 'save' ? 'Saving…' : property ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
