'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { loadFormOptions } from '@/lib/bill-api';
import { ROLES, ROLE_LABELS } from '@/lib/roles';
import { createUser } from '@/lib/user-api';
import {
  NEW_USER_FIELDS,
  validateNewUser,
  type NewUserErrors,
  type NewUserField,
  type UserRecord,
} from '@/lib/user-directory';
import { ErrorAlert, Spinner, colorTransition, focusRing, primaryButton } from '@/app/ui';

type Values = { name: string; email: string; phone: string; role: string };
type Property = { id: number; name: string };

// users.name, email and phone are varchar(255).
const MAX_LENGTH = 255;

const TEXT_FIELDS: { field: keyof Omit<Values, 'role'>; label: string; type: string }[] = [
  { field: 'name', label: 'Full Name', type: 'text' },
  { field: 'email', label: 'Email', type: 'email' },
  { field: 'phone', label: 'Phone (optional)', type: 'tel' },
];

// Text and border colours are left to each field, which changes them with its error.
const controlClass = `h-12 w-full rounded-input border bg-background px-4 text-body text-foreground ${colorTransition} ${focusRing}`;

/**
 * The Add a User modal. It opens when mounted; the parent unmounts it on onClose, which
 * never comes while a save runs. Only system admins open it; the endpoint will check again.
 */
export function AddUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (user: UserRecord) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<Values>({ name: '', email: '', phone: '', role: '' });
  const [propertyIds, setPropertyIds] = useState<number[]>([]);
  /** null while the properties load. */
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [propertiesError, setPropertiesError] = useState('');
  const [errors, setErrors] = useState<NewUserErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // saving as a ref too, set at once: the close guards read it, and a dialog closed straight
  // after a save ends must not see the value from the last render.
  const busyRef = useRef(false);
  /** The focused element, for when the dialog has to be shown again. */
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const id = useId();
  const fieldId = (field: NewUserField | 'phone') => `${id}-${field}`;
  const titleId = `${id}-title`;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // As in vendor-dialog.tsx: Esc is stopped at keydown while saving, before it becomes a
  // close request, because Chrome honours only one cancel preventDefault per activation.
  useEffect(() => {
    function holdEsc(event: KeyboardEvent) {
      if (event.key === 'Escape' && busyRef.current) event.preventDefault();
    }
    window.addEventListener('keydown', holdEsc, true);
    return () => window.removeEventListener('keydown', holdEsc, true);
  }, []);

  // TODO: GET /api/properties once it exists; the bill form's choices list them for now.
  useEffect(() => {
    let active = true;
    loadFormOptions().then((result) => {
      if (!active || !result) return;
      if (result.ok) setProperties(result.data.properties);
      else setPropertiesError(result.error);
    });
    return () => {
      active = false;
    };
  }, []);

  function setBusy(value: boolean) {
    busyRef.current = value;
    setSaving(value);
  }

  // Another kind of close request (a back gesture) can still close a busy dialog. It is
  // shown again, with focus where it was, and the parent isn't told.
  function showAgain() {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected) return;
    dialog.showModal();
    lastFocusRef.current?.focus();
  }

  function change(field: keyof Values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (field !== 'phone') {
      setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    }
  }

  function toggleProperty(propertyId: number, checked: boolean) {
    setPropertyIds((current) =>
      checked ? [...current, propertyId] : current.filter((value) => value !== propertyId),
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const input = { ...values, phone: values.phone || undefined, propertyIds };
    const found = validateNewUser(input);
    const first = NEW_USER_FIELDS.find((field) => found[field]);
    if (first) {
      setErrors(found);
      // An earlier failure's message would read as part of these.
      setError('');
      document.getElementById(fieldId(first))?.focus();
      return;
    }
    setErrors({});
    setError('');
    setBusy(true);

    const names = (properties ?? [])
      .filter((property) => propertyIds.includes(property.id))
      .map((property) => property.name);
    const result = await createUser(input, names);
    // null: apiFetch is sending the user to /login.
    if (!result) return;
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    dialogRef.current?.close();
    onCreated(result.data);
  }

  function errorProps(field: NewUserField) {
    const fieldError = errors[field];
    return {
      'aria-invalid': fieldError ? true : undefined,
      'aria-describedby': fieldError ? `${fieldId(field)}-error` : undefined,
      className: `${controlClass} ${fieldError ? 'border-danger' : 'border-strong focus-visible:border-primary'}`,
    };
  }

  function fieldError(field: NewUserField) {
    const message = errors[field];
    return (
      message && (
        <p id={`${fieldId(field)}-error`} className="text-body-sm text-danger">
          {message}
        </p>
      )
    );
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onFocus={(event) => {
        lastFocusRef.current = event.target;
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
        <span className="underline underline-offset-4">Back</span>
      </button>

      <h2 id={titleId} className="mt-6 text-heading">
        Add a User
      </h2>

      <form noValidate onSubmit={save} className="mt-6 flex flex-col gap-5">
        {TEXT_FIELDS.map(({ field, label, type }) => (
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
              maxLength={MAX_LENGTH}
              required={field !== 'phone'}
              readOnly={saving}
              autoComplete="off"
              {...(field === 'phone'
                ? { className: `${controlClass} border-strong focus-visible:border-primary` }
                : errorProps(field))}
            />
            {field !== 'phone' && fieldError(field)}
          </div>
        ))}

        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId('role')} className="text-body-sm text-secondary">
            Role
          </label>
          <select
            id={fieldId('role')}
            value={values.role}
            onChange={(event) => change('role', event.target.value)}
            required
            disabled={saving}
            {...errorProps('role')}
          >
            <option value="" disabled>
              Choose a role
            </option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          {fieldError('role')}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-sm text-secondary">Properties (optional)</legend>
          {propertiesError ? (
            <ErrorAlert message={propertiesError} />
          ) : !properties ? (
            <p role="status" className="text-body-sm text-secondary">
              Loading properties…
            </p>
          ) : properties.length === 0 ? (
            <p className="text-body-sm text-secondary">No properties yet.</p>
          ) : (
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-input border border-strong p-2">
              {properties.map((property) => (
                <li key={property.id}>
                  <label className="flex items-center gap-3 rounded-button px-2 py-2 text-body hover:bg-raised">
                    <input
                      type="checkbox"
                      checked={propertyIds.includes(property.id)}
                      onChange={(event) => toggleProperty(property.id, event.target.checked)}
                      disabled={saving}
                      className={`size-5 accent-primary ${focusRing}`}
                    />
                    {property.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

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
          {saving ? 'Sending invite…' : 'Send invite'}
        </button>
      </form>
    </dialog>
  );
}
