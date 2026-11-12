"use client";

import { useEffect, useState, type FormEvent } from "react";
import { loadFormOptions } from "@/lib/bill-api";
import type { BillField, BillValues } from "@/lib/bill-validation";
import type { Bill, FormOptions } from "@/lib/bill-view";
import { colorTransition, focusRing, primaryButton, secondaryButton } from "@/app/ui";
import { SubmissionStatus } from "../submission-status";
import { useBillSubmission } from "../use-bill-submission";

const controlClass = `h-12 w-full rounded-input border border-strong bg-background px-4 text-body text-foreground focus-visible:border-primary aria-invalid:border-danger ${colorTransition} ${focusRing}`;

function initialValues(bill: Bill): Record<BillField, string> {
  return {
    vendor_id: String(bill.vendor_id),
    property_id: String(bill.property_id),
    payment_id: String(bill.payment_id),
    invoice_number: bill.invoice_number ?? "",
    amount: String(bill.amount),
    date_due: bill.date_due?.slice(0, 10) ?? "",
  };
}

export function BillEditForm({
  bill,
  onCancel,
  onSaved,
}: {
  bill: Bill;
  onCancel: () => void;
  onSaved: (bill: Bill) => void;
}) {
  const [values, setValues] = useState(() => initialValues(bill));
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const submission = useBillSubmission({ bill });

  useEffect(() => {
    let active = true;
    loadFormOptions().then((result) => {
      if (!active || !result) return;
      if (result.ok) setOptions(result.data);
      else setOptionsError(result.error);
    });
    return () => { 
      active = false;
    };
  }, []);

  function setField(field: BillField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const updated = await submission.update(bill.bill_id, values as BillValues);
    if (updated) onSaved(updated);
  }

  const field = (name: BillField) => ({
    "aria-invalid": Boolean(submission.fieldErrors[name]) || undefined,
    "aria-describedby": submission.fieldErrors[name] ? `${name}-error` : undefined,
  });

  return (
    <form onSubmit={save} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-heading">Edit bill</h1>
          <p className="text-body-sm text-secondary">Draft bill</p>
        </div>
        <p className="text-body text-secondary">Update the bill details, then save your changes.</p>
      </div>

      <SubmissionStatus state={submission.state} message={submission.message} />
      {optionsError && <p role="alert" className="text-body-sm text-danger">{optionsError}</p>}

      <section aria-label="Bill details" className="rounded-card border border-subtle bg-surface p-6 sm:p-8">
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          <Field label="Vendor" name="vendor_id" error={submission.fieldErrors.vendor_id}>
            <select
              id="vendor_id"
              value={values.vendor_id}
              onChange={(event) => setField("vendor_id", event.target.value)}
              disabled={!options || submission.busy}
              className={controlClass}
              {...field("vendor_id")}
            >
              {/* Preserve the current vendor when the loaded choices omit its ID. */}
              {!options?.vendors.some((vendor) => String(vendor.id) === values.vendor_id) && (
                <option value={values.vendor_id}>{bill.vendor?.name ?? "Current vendor unavailable"}</option>
              )}
              {options?.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
          </Field>

          <Field label="Property" name="property_id" error={submission.fieldErrors.property_id}>
            <select
              id="property_id"
              value={values.property_id}
              onChange={(event) => setField("property_id", event.target.value)}
              disabled={!options || submission.busy}
              className={controlClass}
              {...field("property_id")}
            >
              {/* Preserve the current property when the loaded choices omit its ID. */}
              {!options?.properties.some((property) => String(property.id) === values.property_id) && (
                <option value={values.property_id}>{bill.property?.name ?? "Current property unavailable"}</option>
              )}
              {options?.properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
            </select>
          </Field>

          <Field label="Payment method" name="payment_id" error={submission.fieldErrors.payment_id}>
            <select
              id="payment_id"
              value={values.payment_id}
              onChange={(event) => setField("payment_id", event.target.value)}
              disabled={!options || submission.busy}
              className={controlClass}
              {...field("payment_id")}
            >
              {/* Preserve the current payment method when the loaded choices omit its ID. */}
              {!options?.paymentMethods.some((method) => String(method.id) === values.payment_id) && (
                <option value={values.payment_id}>{bill.payment?.name ?? "Current payment method unavailable"}</option>
              )}
              {options?.paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>{method.name} ({method.type})</option>
              ))}
            </select>
          </Field>

          <Field label="Invoice number" name="invoice_number" error={submission.fieldErrors.invoice_number}>
            <input id="invoice_number" value={values.invoice_number} onChange={(event) => setField("invoice_number", event.target.value)} disabled={submission.busy} maxLength={255} className={controlClass} {...field("invoice_number")} />
          </Field>

          <Field label="Amount" name="amount" error={submission.fieldErrors.amount}>
            <input id="amount" value={values.amount} onChange={(event) => setField("amount", event.target.value)} disabled={submission.busy} inputMode="decimal" placeholder="0.00" className={controlClass} {...field("amount")} />
          </Field>

          <Field label="Due date" name="date_due" error={submission.fieldErrors.date_due}>
            <input id="date_due" type="date" value={values.date_due} onChange={(event) => setField("date_due", event.target.value)} disabled={submission.busy} className={controlClass} {...field("date_due")} />
          </Field>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={submission.busy} className={secondaryButton}>Cancel</button>
        <button type="submit" disabled={submission.busy || !options} data-pending={submission.busy || undefined} className={primaryButton}>
          {submission.busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, name, error, children }: { label: string; name: BillField; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={name} className="text-body-sm font-medium">{label}</label>
      {children}
      {error && <p id={`${name}-error`} className="text-body-sm text-danger">{error}</p>}
    </div>
  );
}
