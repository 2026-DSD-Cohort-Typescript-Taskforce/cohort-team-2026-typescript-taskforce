'use client';

// The bill's details as form fields, shared by Enter Bill Details and the fix form: invoice
// number (shown as "Bill ID"), amount, payment type, due date, vendor with its payment
// link, and property. Vendor and property are pick-lists with "Add new"; a new vendor needs
// a payment link because vendors can't be saved without one. Values stay strings until
// validateBill() turns them into what the API takes.

import { useEffect, useId, useState, type ChangeEvent, type ReactNode } from 'react';
import { addProperty, addVendor, loadFormOptions } from '@/lib/bill-api';
import { validateBill, type BillValues } from '@/lib/bill-validation';
import type { Bill, FormOptions } from '@/lib/bill-view';
import { colorTransition, focusRing } from '@/app/ui';

/** The choice that opens the "add a new one" inputs. */
export const NEW = 'new';

export type BillFormValues = {
  invoice_number: string;
  amount: string;
  payment_id: string;
  date_due: string;
  vendor_id: string;
  property_id: string;
  new_vendor_name: string;
  new_vendor_link: string;
  new_property_name: string;
};

export type FormErrors = Partial<Record<keyof BillFormValues, string>>;

const LINK = /^https?:\/\/\S+$/i;

export function emptyValues(): BillFormValues {
  return {
    invoice_number: '',
    amount: '',
    payment_id: '',
    date_due: '',
    vendor_id: '',
    property_id: '',
    new_vendor_name: '',
    new_vendor_link: '',
    new_property_name: '',
  };
}

export function valuesFromBill(bill: Bill): BillFormValues {
  return {
    ...emptyValues(),
    invoice_number: bill.invoice_number ?? '',
    amount: bill.amount == null ? '' : Number(bill.amount).toFixed(2),
    payment_id: bill.payment_id ? String(bill.payment_id) : '',
    date_due: bill.date_due ?? '',
    vendor_id: bill.vendor_id ? String(bill.vendor_id) : '',
    property_id: bill.property_id ? String(bill.property_id) : '',
  };
}

/** The six bill fields, for useBillSubmission. */
export function toBillValues(values: BillFormValues): BillValues {
  const { invoice_number, amount, payment_id, date_due, vendor_id, property_id } = values;
  return { invoice_number, amount, payment_id, date_due, vendor_id, property_id };
}

/** Format checks before saving. A draft may leave any field empty. */
export function checkDetails(values: BillFormValues): FormErrors {
  const result = validateBill({
    ...toBillValues(values),
    vendor_id: values.vendor_id === NEW ? '' : values.vendor_id,
    property_id: values.property_id === NEW ? '' : values.property_id,
  });
  const errors: FormErrors = { ...(result.errors ?? {}) };
  if (values.vendor_id === NEW) {
    if (!values.new_vendor_name.trim()) errors.new_vendor_name = 'Enter the vendor name.';
    if (!LINK.test(values.new_vendor_link.trim())) {
      errors.new_vendor_link = 'Enter a link starting with https://.';
    }
  }
  if (values.property_id === NEW && !values.new_property_name.trim()) {
    errors.new_property_name = 'Enter the property name.';
  }
  return errors;
}

/**
 * Adds a new vendor or property the user typed, and returns the values with their ids,
 * so a retry doesn't add them twice. null while apiFetch sends the user to /login.
 */
export async function resolveChoices(
  values: BillFormValues,
  options: FormOptions,
): Promise<{ values: BillFormValues } | { error: string } | null> {
  let next = values;
  if (next.vendor_id === NEW) {
    const type = options.paymentMethods.find(
      (method) => String(method.id) === next.payment_id,
    )?.type;
    const result = await addVendor({
      name: next.new_vendor_name.trim(),
      payment_portal_url: next.new_vendor_link.trim(),
      supported_payment_methods: type === 'bank' ? 'ACH' : type === 'card' ? 'Card' : 'Card, ACH',
    });
    if (!result) return null;
    if (!result.ok) return { error: result.error };
    next = { ...next, vendor_id: String(result.data.id) };
  }
  if (next.property_id === NEW) {
    const result = await addProperty(next.new_property_name.trim());
    if (!result) return null;
    if (!result.ok) return { error: result.error };
    next = { ...next, property_id: String(result.data.id) };
  }
  return { values: next };
}

export function useFormOptions() {
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    loadFormOptions().then((result) => {
      if (!active || !result) return;
      if (result.ok) setOptions(result.data);
      else setError(result.error);
    });
    return () => {
      active = false;
    };
  }, []);
  return { options, error };
}

const controlClass = `h-12 w-full rounded-input border border-strong bg-background px-4 text-body text-foreground placeholder:text-secondary focus-visible:border-primary disabled:text-secondary ${colorTransition} ${focusRing}`;

/** Step 1 of the mock: the bill's details, for adding and for fixing a bill. */
export function BillFields({
  values,
  onChange,
  options,
  errors = {},
}: {
  values: BillFormValues;
  onChange: (values: BillFormValues) => void;
  options: FormOptions;
  errors?: FormErrors;
}) {
  const set =
    (field: keyof BillFormValues) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ ...values, [field]: event.target.value });
  const vendor = options.vendors.find((option) => String(option.id) === values.vendor_id);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Invoice number (Bill ID)" error={errors.invoice_number}>
        {(props) => (
          <input
            {...props}
            value={values.invoice_number}
            onChange={set('invoice_number')}
            placeholder="Bill ID #"
            className={controlClass}
          />
        )}
      </Field>
      <Field label="Bill amount" error={errors.amount}>
        {(props) => (
          <input
            {...props}
            inputMode="decimal"
            value={values.amount}
            onChange={set('amount')}
            placeholder="Amount to be paid"
            className={controlClass}
          />
        )}
      </Field>
      <Field label="Payment type" error={errors.payment_id}>
        {(props) => (
          <select
            {...props}
            value={values.payment_id}
            onChange={set('payment_id')}
            className={controlClass}
          >
            <option value="">Credit/Debit card, bank…</option>
            {options.paymentMethods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.type === 'bank' ? 'Bank' : 'Card'} · {method.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Bill due date" error={errors.date_due}>
        {(props) => (
          <input
            {...props}
            type="date"
            value={values.date_due}
            onChange={set('date_due')}
            className={controlClass}
          />
        )}
      </Field>

      <div className="sm:col-span-2">
        <Field label="Vendor name" error={errors.vendor_id}>
          {(props) => (
            <select
              {...props}
              value={values.vendor_id}
              onChange={set('vendor_id')}
              className={controlClass}
            >
              <option value="">Which vendor does this bill belong to?</option>
              {options.vendors.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
              <option value={NEW}>+ Add a new vendor</option>
            </select>
          )}
        </Field>
      </div>
      {values.vendor_id === NEW && (
        <div className="sm:col-span-2">
          <Field label="New vendor name" error={errors.new_vendor_name}>
            {(props) => (
              <input
                {...props}
                value={values.new_vendor_name}
                onChange={set('new_vendor_name')}
                className={controlClass}
              />
            )}
          </Field>
        </div>
      )}
      <div className="sm:col-span-2">
        <Field label="Vendor payment link" error={errors.new_vendor_link}>
          {(props) =>
            values.vendor_id === NEW ? (
              <input
                {...props}
                type="url"
                value={values.new_vendor_link}
                onChange={set('new_vendor_link')}
                placeholder="https://vendor-name-123-LLC.com/"
                className={controlClass}
              />
            ) : (
              <input
                {...props}
                value={vendor?.payment_portal_url ?? ''}
                disabled
                placeholder="Choose a vendor"
                className={controlClass}
              />
            )
          }
        </Field>
      </div>

      <div className="sm:col-span-2">
        <Field label="Property name" error={errors.property_id}>
          {(props) => (
            <select
              {...props}
              value={values.property_id}
              onChange={set('property_id')}
              className={controlClass}
            >
              <option value="">Which property was this bill issued to?</option>
              {options.properties.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
              <option value={NEW}>+ Add a new property</option>
            </select>
          )}
        </Field>
      </div>
      {values.property_id === NEW && (
        <div className="sm:col-span-2">
          <Field label="New property name" error={errors.new_property_name}>
            {(props) => (
              <input
                {...props}
                value={values.new_property_name}
                onChange={set('new_property_name')}
                className={controlClass}
              />
            )}
          </Field>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-body-sm font-semibold">
        {label}
      </label>
      {children({
        id,
        'aria-describedby': error ? errorId : undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {error && (
        <p id={errorId} className="text-body-sm text-error-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
