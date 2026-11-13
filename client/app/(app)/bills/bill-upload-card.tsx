'use client';

// The upload card: pick or drop one bill document, see it in a local preview, then
// "Extract bill" uploads it to Storage and runs extraction. The outcome decides what shows:
// a success message (submitted or draft), a duplicate warning linking the existing bill, a
// "Replace PDF?" question for a draft with the same invoice, or an error. Outcomes that
// leave no draft are also added to Current issues as notices.

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { extractBill } from '@/lib/bill-api';
import { uploadPending } from '@/lib/bill-storage';
import {
  billUploadError,
  billUploadKind,
  formatFileSize,
  type BillUploadKind,
} from '@/lib/bill-upload';
import { noticeFor } from '@/lib/extraction';
import {
  ErrorAlert,
  SuccessAlert,
  colorTransition,
  focusRing,
  primaryButton,
  secondaryButton,
} from '@/app/ui';
import { useBillsRefresh } from './bills-provider';
import { useIntake } from './intake-provider';

const ACCEPT = '.pdf,application/pdf';

type Chosen = { name: string; size: number; kind: BillUploadKind; file: File; url: string };
type Step = 'idle' | 'uploading' | 'extracting';

const actionClass = 'text-body font-semibold';
const warningClass =
  'flex flex-wrap items-center gap-2 rounded-input border border-warning-border bg-warning-surface px-4 py-2 text-body-sm text-warning-foreground';

/**
 * Left card on FigJam "Bill Intake \"Pay Bill\"" (node 143:2287): add, upload, and the
 * preview well. "Extract bill" uploads the PDF and reads it into a bill.
 */
export function BillUploadCard() {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [duplicateOf, setDuplicateOf] = useState<number | null>(null);
  const [replace, setReplace] = useState<{ path: string; billId: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const refreshBills = useBillsRefresh();
  const { setPanel, addNotice } = useIntake();

  useEffect(() => {
    if (!chosen) return;
    return () => URL.revokeObjectURL(chosen.url);
  }, [chosen]);

  function clearMessages() {
    setError('');
    setSuccess('');
    setDuplicateOf(null);
    setReplace(null);
  }

  function take(file: File | undefined) {
    if (!file) return;
    const message = billUploadError(file);
    if (message) {
      setError(message);
      return;
    }
    const kind = billUploadKind(file);
    if (!kind) return;
    clearMessages();
    setChosen({ name: file.name, size: file.size, kind, file, url: URL.createObjectURL(file) });
    if (inputRef.current) inputRef.current.value = '';
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const { files } = event.dataTransfer;
    if (files.length > 1) {
      setError('Add one bill at a time.');
      return;
    }
    take(files[0]);
  }

  async function extract(file: Chosen, path: string, replaceBillId?: number) {
    setStep('extracting');
    const result = await extractBill(path, replaceBillId);
    setStep('idle');
    if (!result) return; // apiFetch is sending the user to /login.
    if (!result.ok) {
      setError(result.error);
      return;
    }

    const outcome = result.data;
    refreshBills();
    if (outcome.outcome === 'confirm_replace' && outcome.bill) {
      setReplace({ path, billId: outcome.bill.bill_id });
      return;
    }
    const notice = noticeFor(outcome, file.name);
    if (notice) addNotice(notice);

    if (outcome.outcome === 'submitted' || outcome.outcome === 'draft') {
      setSuccess(outcome.message);
      setChosen(null);
    } else if (outcome.outcome === 'duplicate') {
      setDuplicateOf(outcome.bill?.bill_id ?? null);
    } else {
      setError(outcome.message);
    }
  }

  async function upload() {
    if (!chosen || step !== 'idle') return;
    clearMessages();
    setStep('uploading');
    const pending = await uploadPending(chosen.file);
    if (!pending) return; // apiFetch is sending the user to /login.
    if (!pending.ok) {
      setStep('idle');
      if (pending.duplicateBillId) setDuplicateOf(pending.duplicateBillId);
      else setError(pending.error);
      return;
    }
    await extract(chosen, pending.path);
  }

  async function confirmReplace() {
    if (!chosen || !replace) return;
    const { path, billId } = replace;
    setReplace(null);
    await extract(chosen, path, billId);
  }

  return (
    <section
      aria-label="Add or upload a bill"
      className="flex h-full min-h-0 flex-col rounded-card border border-subtle bg-surface"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-subtle px-6 py-4">
        <button
          type="button"
          onClick={() => setPanel({ kind: 'add' })}
          className={`${actionClass} underline underline-offset-4 ${focusRing}`}
        >
          + Add a Bill
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`${actionClass} underline underline-offset-4 ${focusRing}`}
        >
          + Upload a Bill
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <label
          htmlFor={inputId}
          data-dragging={dragging || undefined}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setDragging(false);
          }}
          onDrop={onDrop}
          className={`flex min-h-0 flex-1 cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-input border border-strong bg-background px-6 py-10 text-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary hover:border-primary hover:bg-raised data-dragging:border-primary data-dragging:bg-raised ${colorTransition}`}
        >
          {chosen ? (
            <>
              <iframe
                title={chosen.name}
                src={chosen.url}
                className="h-full min-h-0 w-full bg-background"
              />
              <span className="text-body-sm text-secondary">
                {chosen.name} · {formatFileSize(chosen.size)}
              </span>
            </>
          ) : (
            <span className="text-body-lg font-semibold tracking-wide text-secondary uppercase">
              + Bill upload preview
            </span>
          )}
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPT}
            aria-label="Upload a bill"
            aria-describedby={error ? errorId : undefined}
            className="sr-only"
            onChange={(event) => take(event.target.files?.[0])}
          />
        </label>

        {chosen && (
          <button
            type="button"
            onClick={upload}
            disabled={step !== 'idle'}
            data-pending={step !== 'idle' || undefined}
            className={`${primaryButton} self-end`}
          >
            {step === 'uploading'
              ? 'Uploading…'
              : step === 'extracting'
                ? 'Reading the bill…'
                : 'Extract bill'}
          </button>
        )}

        <div role="status">
          {duplicateOf && (
            <p className={warningClass}>
              This PDF was already uploaded.
              <Link
                href={`/bills/${duplicateOf}`}
                className={`font-semibold underline ${focusRing}`}
              >
                Open the existing bill
              </Link>
            </p>
          )}
          {replace && (
            <div className={`${warningClass} flex-col items-start`}>
              <p>A draft for this invoice already exists. Replace its PDF and read it again?</p>
              <div className="flex gap-3">
                <button type="button" onClick={confirmReplace} className={primaryButton}>
                  Replace PDF
                </button>
                <button type="button" onClick={() => setReplace(null)} className={secondaryButton}>
                  Keep the original
                </button>
              </div>
            </div>
          )}
        </div>
        <SuccessAlert message={success} />
        <ErrorAlert id={errorId} message={error} />
      </div>
    </section>
  );
}
