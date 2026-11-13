'use client';

// The fix form inside Current issues: finishes one draft, prefilled from the bill. Save
// draft keeps it a draft with whatever is filled in; Submit for payment saves it and runs
// submit_bill(), which only billing operators can do. Once a draft has every detail it
// drops off Current issues on the next refresh.

import { useState } from 'react';
import { ErrorAlert, focusRing, primaryButton, secondaryButton } from '@/app/ui';
import {
  BillFields,
  checkDetails,
  emptyValues,
  resolveChoices,
  toBillValues,
  useFormOptions,
  valuesFromBill,
  type FormErrors,
} from './bill-fields';
import { useBills } from './bills-provider';
import { useIntake } from './intake-provider';
import { SubmissionStatus } from './submission-status';
import { useBillSubmission } from './use-bill-submission';

/** Finishes a draft from Current issues. Its PDF shows in the left column meanwhile. */
export function FixBillForm({ billId }: { billId: number }) {
  const { bills } = useBills();
  const bill = bills?.find((item) => item.bill_id === billId) ?? null;
  const { setPanel } = useIntake();
  const { options, error: optionsError } = useFormOptions();
  const [values, setValues] = useState(() => (bill ? valuesFromBill(bill) : emptyValues()));
  const [errors, setErrors] = useState<FormErrors>({});
  const [problem, setProblem] = useState('');
  const submission = useBillSubmission({ bill });
  const close = () => setPanel({ kind: 'upload' });

  async function finish(action: 'save' | 'submit') {
    if (!options || submission.busy) return;
    const found = checkDetails(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
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

  if (!bill) {
    return (
      <div className="flex flex-col gap-3 p-5">
        <p className="text-body">This bill is no longer a draft.</p>
        <button type="button" onClick={close} className={secondaryButton}>
          Back to Current issues
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <button
        type="button"
        onClick={close}
        className={`self-start text-body font-semibold underline underline-offset-4 ${focusRing}`}
      >
        ← Cancel
      </button>
      <h3 className="text-body-lg font-semibold">
        Fix bill from {bill.vendor?.name ?? 'an unknown vendor'}
      </h3>
      <ErrorAlert message={optionsError || problem} />
      {options && (
        <BillFields
          values={values}
          onChange={setValues}
          options={options}
          errors={{ ...errors, ...submission.fieldErrors }}
        />
      )}
      <SubmissionStatus state={submission.state} message={submission.message} />
      <div className="flex flex-wrap justify-end gap-3">
        {submission.state === 'submitted' ? (
          <button type="button" onClick={close} className={primaryButton}>
            Done
          </button>
        ) : (
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
      </div>
    </div>
  );
}
