'use client';

import { useId, useState } from 'react';
import { ANSWER_MAX, type PolicyDraft } from '@/lib/policy-drafts';
import type { PropertyRef } from '@/lib/policy-rule';
import { ruleLines } from '@/lib/policy-rule-lines';
import { Spinner, colorTransition, focusRing, primaryButton, secondaryButton } from '@/app/ui';

const inputClass = `h-12 w-full rounded-input border border-strong bg-background px-4 text-body text-foreground placeholder:text-secondary focus-visible:border-primary ${colorTransition} ${focusRing}`;

/** What the model understood, then what the status needs: answers, a new sentence, or a yes. */
export function PolicyReview({
  draft,
  properties,
  busy,
  pending,
  onSendAnswers,
  onChangeSentence,
  onConfirm,
}: {
  draft: PolicyDraft;
  properties: PropertyRef[];
  /** A request is running: every action ignores clicks. */
  busy: boolean;
  /** Which action's request is running, for its spinner. */
  pending: 'answers' | 'confirm' | null;
  onSendAnswers: (answers: Array<{ question_id: string; answer: string }>) => void;
  onChangeSentence: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const lines = draft.rule ? ruleLines(draft.rule, properties) : [];
  const filled = draft.questions
    .map((q) => ({ question_id: q.id, answer: (answers[q.id] ?? '').trim() }))
    .filter((a) => a.answer);

  const changeButton = (
    <button
      type="button"
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onChangeSentence();
      }}
      className={secondaryButton}
    >
      Change sentence
    </button>
  );

  return (
    <div className="mt-6 flex flex-col gap-5">
      <h3 data-step-heading tabIndex={-1} className="text-subheading outline-none">
        Here&apos;s how we read it
      </h3>
      {draft.interpretation && <p className="text-body break-words">{draft.interpretation}</p>}
      {lines.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-body-sm break-words">
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      {draft.not_covered && (
        <p className="text-body-sm break-words text-secondary">
          <span className="font-medium">Not covered:</span> {draft.not_covered}
        </p>
      )}

      {draft.status === 'needs_clarification' && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && filled.length > 0) onSendAnswers(filled);
          }}
          className="flex flex-col gap-4"
        >
          {draft.questions.map((question) => (
            <div key={question.id} className="flex flex-col gap-1">
              <label htmlFor={`${id}-${question.id}`} className="text-body-sm text-secondary">
                {question.question}
              </label>
              <input
                id={`${id}-${question.id}`}
                type="text"
                value={answers[question.id] ?? ''}
                readOnly={busy}
                maxLength={ANSWER_MAX}
                autoComplete="off"
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                }
                className={inputClass}
              />
            </div>
          ))}
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            {changeButton}
            <button
              type="submit"
              aria-disabled={busy || filled.length === 0 || undefined}
              data-pending={pending === 'answers' || undefined}
              className={primaryButton}
            >
              {pending === 'answers' && <Spinner />}
              {pending === 'answers' ? 'Sending…' : 'Send answers'}
            </button>
          </div>
        </form>
      )}

      {draft.status === 'unsupported' && (
        <>
          <ul className="space-y-2 text-body-sm break-words">
            {draft.unsupported.map((part, index) => (
              <li key={index}>
                <span className="font-medium">&ldquo;{part.text}&rdquo;</span>{' '}
                <span className="text-secondary">{part.reason}</span>
              </li>
            ))}
          </ul>
          <div className="flex sm:justify-end">{changeButton}</div>
        </>
      )}

      {draft.status === 'conflicting' && (
        <>
          <ul className="space-y-2 text-body-sm break-words">
            {draft.conflicts.map((conflict, index) => (
              <li key={index}>{conflict.explanation}</li>
            ))}
          </ul>
          <div className="flex sm:justify-end">{changeButton}</div>
        </>
      )}

      {draft.status === 'complete' && (
        <>
          <p className="text-body font-medium">Is this what you wanted?</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            {changeButton}
            <button
              type="button"
              aria-disabled={busy || undefined}
              data-pending={pending === 'confirm' || undefined}
              onClick={() => {
                if (!busy) onConfirm();
              }}
              className={primaryButton}
            >
              {pending === 'confirm' && <Spinner />}
              {pending === 'confirm' ? 'Turning on…' : 'Yes, turn it on'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
