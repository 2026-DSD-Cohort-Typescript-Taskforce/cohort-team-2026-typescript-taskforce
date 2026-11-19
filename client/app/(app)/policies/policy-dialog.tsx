'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { confirmDraft, continueDraft, loadDraft, savePolicy, startDraft } from '@/lib/policy-api';
import type { Policy, PolicyVendor } from '@/lib/policies';
import { chooseDraftAction, draftPolicyIsStale, type PolicyDraft } from '@/lib/policy-drafts';
import type { PropertyRef } from '@/lib/policy-rule';
import {
  POLICY_FIELDS,
  POLICY_NAME_MAX,
  POLICY_TEXT_MAX,
  validatePolicyInput,
  type PolicyErrors,
  type PolicyField,
} from '@/lib/policy-validation';
import {
  ErrorAlert,
  Spinner,
  colorTransition,
  focusRing,
  primaryButton,
  secondaryButton,
} from '@/app/ui';
import { PolicyReview } from './policy-review';

// Text and border colours are left to each field, which changes them with its error.
const controlClass = `w-full rounded-input border bg-background px-4 text-body text-foreground placeholder:text-secondary ${colorTransition} ${focusRing}`;

const NOT_SET_UP = "Policy checking isn't set up yet.";

type Step = 'loading' | 'edit' | 'review';
type Action = 'save' | 'check' | 'answers' | 'confirm';

/**
 * The "Edit Policy Details" modal, for a new policy and an existing one. Step 1 takes the
 * name and the sentence; "Check policy" has the sentence read (DC-90) and step 2 shows how,
 * with questions to answer or "Yes, turn it on" (DC-91). A stored draft opens at step 2. It
 * opens when mounted; the parent unmounts it on onClose, which never comes while a request
 * runs. Only managers open it; the routes check again.
 */
export function PolicyDialog({
  vendor,
  onClose,
  properties,
  onSaved,
  onGone,
}: {
  vendor: PolicyVendor;
  /** For the rule lines; empty if they didn't load (lines then say "property 3"). */
  properties: PropertyRef[];
  onClose: () => void;
  onSaved: (vendorId: number, policy: Policy, how: 'saved' | 'on') => void;
  /** The vendor (or its policy) was deleted elsewhere (404); the message is the reply's. */
  onGone: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<Record<PolicyField, string>>({
    name: vendor.policy?.name ?? '',
    description: vendor.policy?.description ?? '',
  });
  const [errors, setErrors] = useState<PolicyErrors>({});
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [step, setStep] = useState<Step>('loading');
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  // The policy changed since the draft was made, so "Check policy" starts it again.
  const [policyChanged, setPolicyChanged] = useState(false);
  const [error, setError] = useState('');
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

  // A stored draft resumes at step 2; no draft, or one that can't be loaded, starts at step 1.
  useEffect(() => {
    let active = true;
    loadDraft(vendor.vendor_id).then((result) => {
      // null: apiFetch is sending the user to /login.
      if (!active || !result) return;
      if (result.ok && result.data) {
        setPolicyChanged(
          draftPolicyIsStale(result.data.policy_updated_at, vendor.policy?.updated_at ?? null),
        );
        showDraft(result.data);
      } else {
        if (!result.ok) {
          if (result.status === 404) {
            dialogRef.current?.close();
            onGone(result.error);
            return;
          }
          setError(result.error);
        }
        setStep('edit');
      }
    });
    return () => {
      active = false;
    };
    // Runs once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus follows the step, not the first render: the new step's heading, or the sentence.
  // A new draft revision in step 2 remounts the review (dropping the focused button), so it
  // refocuses the heading too.
  const firstStep = useRef(true);
  useEffect(() => {
    if (step === 'loading') return;
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    if (step === 'review') {
      dialogRef.current?.querySelector<HTMLElement>('[data-step-heading]')?.focus();
    } else {
      document.getElementById(fieldId('description'))?.focus();
    }
    // fieldId only reads the stable id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, draft?.revision]);

  // Chrome honours one cancel preventDefault per user activation, so a second Esc would
  // close a saving dialog: Esc is stopped at keydown instead, wherever focus is.
  useEffect(() => {
    function holdEsc(event: KeyboardEvent) {
      if (event.key === 'Escape' && busyRef.current) event.preventDefault();
    }
    window.addEventListener('keydown', holdEsc, true);
    return () => window.removeEventListener('keydown', holdEsc, true);
  }, []);

  function setBusy(value: Action | null) {
    busyRef.current = value !== null;
    setSaving(value !== null);
    setAction(value);
  }

  /** Step 2 with this draft; the sentence field then holds the draft's, for "Change sentence". */
  function showDraft(next: PolicyDraft) {
    setDraft(next);
    setValues((current) => ({ ...current, description: next.sentence }));
    setStep('review');
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

  /** Both fields checked; on failure the errors are shown and focus goes to the first. */
  function validated() {
    const checked = validatePolicyInput(values);
    if ('errors' in checked) {
      showFieldErrors(checked.errors);
      return null;
    }
    setErrors({});
    setError('');
    return checked.input;
  }

  function showFieldErrors(fieldErrors: PolicyErrors) {
    setErrors(fieldErrors);
    // An earlier reply's message (a 403, offline) would read as part of these.
    setError('');
    const first = POLICY_FIELDS.find((field) => fieldErrors[field]);
    // The step may not be showing the fields yet: focus waits for it.
    if (first) setTimeout(() => document.getElementById(fieldId(first))?.focus());
  }

  /** The answer to a failed draft request: its message, and the draft it came with. */
  function fail(result: {
    status: number;
    error: string;
    code?: string;
    draft?: PolicyDraft | null;
  }) {
    if (result.status === 404 && result.code === 'draft_not_found') {
      // The draft is gone (turned on or cleared elsewhere): back to a fresh step 1.
      setDraft(null);
      setStep('edit');
      setError(result.error);
    } else if (result.status === 404) {
      dialogRef.current?.close();
      onGone(result.error);
    } else if (result.code === 'invalid_policy') {
      // The name or sentence failed the route's rules: back to the fields.
      setStep('edit');
      setError(result.error);
    } else {
      // 403, 400, 409 (stale_draft, policy_changed, draft_not_complete, invalid_rule),
      // 422, 502 or offline: the reply's own message; 503 says checking isn't set up.
      if (result.code === 'policy_changed') setPolicyChanged(true);
      setError(result.status === 503 ? NOT_SET_UP : result.error);
      if (result.draft) showDraft(result.draft);
    }
  }

  /** Name-only edit keeps the DC-85 save; anything else has the sentence checked. */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const input = validated();
    if (!input) return;
    const unchanged = !draft && vendor.policy && input.description === vendor.policy.description;
    if (unchanged && input.name !== vendor.policy?.name) {
      await run(
        'save',
        () => savePolicy(vendor.vendor_id, input),
        (policy) => {
          dialogRef.current?.close();
          onSaved(vendor.vendor_id, policy, 'saved');
        },
      );
      return;
    }
    const restart = chooseDraftAction({ hasDraft: draft !== null, policyChanged }) === 'start';
    await run(
      'check',
      () =>
        draft && !restart
          ? continueDraft(vendor.vendor_id, draft.revision, { sentence: input.description })
          : startDraft(vendor.vendor_id, input.description),
      (next) => {
        // A start reads the policy's updated_at again.
        if (restart) setPolicyChanged(false);
        if (next) showDraft(next);
      },
    );
  }

  async function sendAnswers(answers: Array<{ question_id: string; answer: string }>) {
    if (busyRef.current || !draft) return;
    setError('');
    await run(
      'answers',
      () => continueDraft(vendor.vendor_id, draft.revision, { answers }),
      (next) => {
        if (next) showDraft(next);
      },
    );
  }

  async function turnOn() {
    if (busyRef.current || !draft) return;
    const input = validatePolicyInput({ name: values.name, description: values.description });
    // The sentence may be mid-edit here; only the name travels with the confirm.
    if ('errors' in input && input.errors.name) {
      setStep('edit');
      showFieldErrors({ name: input.errors.name });
      return;
    }
    setError('');
    await run(
      'confirm',
      () => confirmDraft(vendor.vendor_id, draft.revision, values.name.trim()),
      (policy) => {
        dialogRef.current?.close();
        onSaved(vendor.vendor_id, policy, 'on');
      },
    );
  }

  /** Runs one request with the busy guards; null from apiFetch means it is sending to /login. */
  async function run<T>(
    which: Action,
    request: () => Promise<
      | { ok: true; data: T }
      | { ok: false; status: number; error: string; code?: string; draft?: PolicyDraft | null }
      | null
    >,
    done: (data: T) => void,
  ) {
    setBusy(which);
    const result = await request();
    if (!result) return;
    setBusy(null);
    if (result.ok) done(result.data);
    else fail(result);
  }

  function changeSentence() {
    if (busyRef.current) return;
    setError('');
    setStep('edit');
  }

  const checking = action === 'check' || action === 'save';
  const nameOnly =
    !draft &&
    !!vendor.policy &&
    values.description.trim() === vendor.policy.description &&
    values.name.trim() !== vendor.policy.name;

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
        {step === 'review' ? 'Review Policy' : 'Edit Policy Details'}
      </h2>
      <p className="mt-1 text-body break-words text-secondary">{vendor.name}</p>

      {step === 'loading' && (
        <div role="status" className="mt-6 flex items-center gap-2 text-body text-secondary">
          <Spinner />
          Loading…
        </div>
      )}

      {step === 'edit' && (
        <form noValidate onSubmit={submit} className="mt-6 flex flex-col gap-5">
          {POLICY_FIELDS.map((field) => {
            const fieldError = errors[field];
            const errorId = `${fieldId(field)}-error`;
            const shared = {
              id: fieldId(field),
              value: values[field],
              required: true,
              // readOnly, not disabled, while saving: the field keeps focus if Enter saved.
              readOnly: saving,
              autoComplete: 'off',
              'aria-invalid': fieldError ? (true as const) : undefined,
              'aria-describedby': fieldError ? errorId : undefined,
              className: `${controlClass} ${fieldError ? 'border-danger' : 'border-strong focus-visible:border-primary'}`,
            };
            return (
              <div key={field} className="flex flex-col gap-1">
                <label htmlFor={fieldId(field)} className="text-body-sm text-secondary">
                  {field === 'name' ? 'Policy Name' : 'Policy'}
                </label>
                {field === 'name' ? (
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
              request leaves the user on it. submit() ignores the click. */}
          <button
            type="submit"
            aria-disabled={saving || undefined}
            data-pending={checking || undefined}
            className={`w-full sm:w-auto sm:min-w-40 sm:self-end ${nameOnly ? secondaryButton : primaryButton}`}
          >
            {checking && <Spinner />}
            {nameOnly
              ? action === 'save'
                ? 'Saving…'
                : 'Save'
              : checking
                ? 'Checking…'
                : 'Check policy'}
          </button>
        </form>
      )}

      {step === 'review' && draft && (
        <>
          <PolicyReview
            key={draft.revision}
            draft={draft}
            properties={properties}
            busy={saving}
            pending={action === 'answers' || action === 'confirm' ? action : null}
            onSendAnswers={sendAnswers}
            onChangeSentence={changeSentence}
            onConfirm={turnOn}
          />
          <ErrorAlert message={error} className="mt-5" />
        </>
      )}
    </dialog>
  );
}
