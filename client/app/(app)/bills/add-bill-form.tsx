'use client';

// Enter Bill Details, opened by "+ Add a Bill": a bill entered by hand in three steps, the
// details, an optional bill document, then a review with Save draft or Submit for payment.
// Nothing is saved before step 3. A new vendor or property typed in the form is added
// first, and the PDF is attached to the saved draft before it's submitted.

import { useId, useRef, useState } from 'react';
import { attachDocument } from '@/lib/bill-api';
import { uploadPending } from '@/lib/bill-storage';
import { billUploadError, formatFileSize } from '@/lib/bill-upload';
import type { FormOptions } from '@/lib/bill-view';
import { ErrorAlert, focusRing, primaryButton, secondaryButton } from '@/app/ui';
import {
  BillFields,
  NEW,
  checkDetails,
  emptyValues,
  resolveChoices,
  toBillValues,
  useFormOptions,
  type BillFormValues,
  type FormErrors,
} from './bill-fields';
import { useIntake } from './intake-provider';
import { SubmissionStatus } from './submission-status';
import { useBillSubmission } from './use-bill-submission';

const STEPS = ['Details', 'PDF', 'Review'] as const;

/** "+ Add a Bill": details, an optional PDF, then review and save or submit. */
export function AddBillForm() {
  const fileId = useId();
  const { setPanel } = useIntake();
  const { options, error: optionsError } = useFormOptions();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState(emptyValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState('');
  // The draft the PDF went onto, so saving again doesn't upload it twice.
  const attachedTo = useRef<number | null>(null);

  const submission = useBillSubmission({
    afterSave: async (bill) => {
      if (!file || attachedTo.current === bill.bill_id) return null;
      const pending = await uploadPending(file);
      if (!pending) return 'Sign in again to attach the PDF.';
      if (!pending.ok) return pending.error;
      const attached = await attachDocument(bill.bill_id, pending.path);
      if (!attached) return 'Sign in again to attach the PDF.';
      if (!attached.ok) return attached.error;
      attachedTo.current = bill.bill_id;
      return null;
    },
  });
  const done = submission.state === 'saved' || submission.state === 'submitted';

  function next() {
    if (step === 0) {
      const found = checkDetails(values);
      setErrors(found);
      if (Object.keys(found).length > 0) return;
    }
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function pickFile(picked: File | undefined) {
    if (!picked) return;
    const message = billUploadError(picked);
    setProblem(message ?? '');
    setFile(message ? null : picked);
  }

  async function finish(action: 'save' | 'submit') {
    if (!options || submission.busy) return;
    setProblem('');
    const resolved = await resolveChoices(values, options);
    if (!resolved) return;
    if ('error' in resolved) {
      setProblem(resolved.error);
      return;
    }
    setValues(resolved.values);
    const billValues = toBillValues(resolved.values);
    if (action === 'save') await submission.saveDraft(billValues);
    else await submission.submit(billValues);
  }

  return (
    <section
      aria-label="Enter bill details"
      className="flex h-full min-h-0 flex-col overflow-y-auto rounded-card border border-subtle bg-surface"
    >
      <div className="border-b border-subtle px-6 py-4">
        <button
          type="button"
          onClick={() => setPanel({ kind: 'upload' })}
          className={`text-body font-semibold underline underline-offset-4 ${focusRing}`}
        >
          ← Cancel
        </button>
      </div>

      <div className="flex flex-col gap-6 p-6">
        <header className="flex flex-col items-center gap-2 text-center">
          <h2 className="text-heading">Enter Bill Details</h2>
          <p className="text-body-sm text-secondary">
            This information will be used to create a new bill. This may be edited later.
          </p>
          <ol aria-label="Steps" className="flex items-center gap-3">
            {STEPS.map((name, index) => (
              <li
                key={name}
                aria-current={index === step ? 'step' : undefined}
                className={`flex size-8 items-center justify-center rounded-full border text-body-sm ${index <= step ? 'border-primary bg-primary text-on-primary' : 'border-strong'}`}
              >
                {index + 1}
                <span className="sr-only">{name}</span>
              </li>
            ))}
          </ol>
          <p className="text-body-sm text-secondary">
            Step {step + 1} of {STEPS.length}
          </p>
        </header>

        <ErrorAlert message={optionsError || problem} />

        {step === 0 && options && (
          <BillFields values={values} onChange={setValues} options={options} errors={errors} />
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <label className="text-body-sm font-semibold" htmlFor={fileId}>
              Attach the bill&apos;s PDF (optional)
            </label>
            <input
              id={fileId}
              type="file"
              accept=".pdf,application/pdf"
              onChange={(event) => pickFile(event.target.files?.[0])}
            />
            {file && (
              <p className="text-body-sm text-secondary">
                {file.name} · {formatFileSize(file.size)}
              </p>
            )}
          </div>
        )}

        {step === 2 && options && <Review values={values} file={file} options={options} />}

        <SubmissionStatus state={submission.state} message={submission.message} />

        <div className="flex flex-wrap justify-end gap-3">
          {step > 0 && !done && (
            <button type="button" onClick={() => setStep(step - 1)} className={secondaryButton}>
              Back
            </button>
          )}
          {step < 2 && (
            <button type="button" onClick={next} disabled={!options} className={primaryButton}>
              Continue
            </button>
          )}
          {step === 2 && !done && (
            <>
              <button
                type="button"
                onClick={() => finish('save')}
                disabled={submission.busy}
                className={secondaryButton}
              >
                Save draft
              </button>
              {submission.canSubmit && (
                <button
                  type="button"
                  onClick={() => finish('submit')}
                  disabled={submission.busy}
                  className={primaryButton}
                >
                  Submit for payment
                </button>
              )}
            </>
          )}
          {done && (
            <button
              type="button"
              onClick={() => setPanel({ kind: 'upload' })}
              className={primaryButton}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Review({
  values,
  file,
  options,
}: {
  values: BillFormValues;
  file: File | null;
  options: FormOptions;
}) {
  const pick = (list: { id: number; name: string }[], id: string, typed: string) =>
    id === NEW ? `${typed} (new)` : (list.find((item) => String(item.id) === id)?.name ?? '—');
  const rows: [string, string][] = [
    ['Invoice number', values.invoice_number || '—'],
    ['Amount', values.amount || '—'],
    ['Payment type', pick(options.paymentMethods, values.payment_id, '')],
    ['Due date', values.date_due || '—'],
    ['Vendor', pick(options.vendors, values.vendor_id, values.new_vendor_name)],
    ['Property', pick(options.properties, values.property_id, values.new_property_name)],
    ['PDF', file?.name ?? 'None'],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-secondary">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
