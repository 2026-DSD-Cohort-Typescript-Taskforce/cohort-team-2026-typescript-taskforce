// The states of saving and submitting a bill from the bill form (DC-76), and the message
// each one shows. useBillSubmission() (app/bills/use-bill-submission.ts) runs it with
// React's useReducer. Only imports with a .ts extension, so `npm test` (node --test) can
// load it.

import type { ApiFailure } from "./bill-api.ts";
import { missingForSubmit, submitHint, type BillInput, type FieldErrors } from "./bill-validation.ts";
import type { Bill } from "./bill-view.ts";

export type SubmissionState = "idle" | "saving" | "submitting" | "saved" | "submitted" | "partial" | "error";

/** The request that failed: saving a new draft, saving changes to one, or submit_bill(). */
export type Step = "create" | "update" | "submit";

export type Submission = {
  state: SubmissionState;
  /** What the status region shows and announces; "" when idle. */
  message: string;
  /** One message per field to fix, for the form to show next to each. */
  fieldErrors: FieldErrors;
  /** The route's code when it refused (e.g. not_draft, duplicate_invoice), else null. */
  errorCode: string | null;
  /** The bill as last saved here. A later save or submit updates it instead of adding one. */
  bill: Bill | null;
};

export type SubmissionEvent =
  | { type: "start"; action: "save" | "submit" }
  | { type: "invalid"; fieldErrors: FieldErrors; message: string }
  | { type: "stored"; bill: Bill }
  | { type: "saved"; step: "create" | "update" }
  | { type: "submitted"; status: string }
  | { type: "failed"; step: Step; failure: ApiFailure }
  | { type: "reset"; bill: Bill | null };

export const MESSAGES = {
  saving: "Saving the bill…",
  submitting: "Submitting the bill…",
  created: "Draft saved.",
  updated: "Bill updated.",
  submitted: "Bill submitted for payment.",
  invalid: "Some of the bill's details aren't valid.",
  notDraft: "This bill was submitted and can't be edited anymore.",
  notFound: "This bill no longer exists.",
  required: "Required to submit.",
};

export function initialSubmission(bill: Bill | null = null): Submission {
  return { state: "idle", message: "", fieldErrors: {}, errorCode: null, bill };
}

export function submissionReducer(current: Submission, event: SubmissionEvent): Submission {
  switch (event.type) {
    case "start":
      return {
        ...current,
        state: event.action === "save" ? "saving" : "submitting",
        message: event.action === "save" ? MESSAGES.saving : MESSAGES.submitting,
        fieldErrors: {},
        errorCode: null,
      };
    case "invalid":
      return { ...current, state: "error", message: event.message, fieldErrors: event.fieldErrors, errorCode: null };
    // Keeps the state: submitting continues with submit_bill().
    case "stored":
      return { ...current, bill: event.bill };
    case "saved":
      return { ...current, state: "saved", message: event.step === "create" ? MESSAGES.created : MESSAGES.updated };
    case "submitted":
      return {
        ...current,
        state: "submitted",
        message: MESSAGES.submitted,
        bill: current.bill && { ...current.bill, status: event.status },
      };
    case "failed": {
      const { message, fieldErrors } = describeFailure(event.failure, event.step);
      // The draft was saved just before submit_bill() refused it, so it isn't lost.
      if (event.step === "submit" && current.state === "submitting" && current.bill) {
        return {
          ...current,
          state: "partial",
          message: `Draft saved, but it couldn't be submitted: ${lowerFirst(message)}`,
          fieldErrors,
          errorCode: event.failure.code ?? null,
        };
      }
      return { ...current, state: "error", message, fieldErrors, errorCode: event.failure.code ?? null };
    }
    case "reset":
      return initialSubmission(event.bill);
  }
}

/**
 * The fields a submit still needs, as an "invalid" event, or null when there are none.
 * Saving a draft doesn't need them.
 */
export function checkSubmittable(input: BillInput): Extract<SubmissionEvent, { type: "invalid" }> | null {
  const missing = missingForSubmit(input);
  if (missing.length === 0) return null;
  const fieldErrors = Object.fromEntries(missing.map((field) => [field, MESSAGES.required]));
  return { type: "invalid", fieldErrors, message: submitHint(missing) };
}

/** A refused request as a message for the status region and the fields to mark. */
export function describeFailure(failure: ApiFailure, step: Step): { message: string; fieldErrors: FieldErrors } {
  const fields = (failure.fields ?? []) as (keyof FieldErrors)[];
  switch (failure.code) {
    case "duplicate_invoice":
      return { message: failure.error, fieldErrors: { invoice_number: failure.error } };
    case "invalid_bill":
      return { message: failure.error, fieldErrors: Object.fromEntries(fields.map((field) => [field, failure.error])) };
    case "incomplete_bill":
      return {
        message: submitHint(fields) || failure.error,
        fieldErrors: Object.fromEntries(fields.map((field) => [field, MESSAGES.required])),
      };
    case "not_draft":
      return { message: step === "submit" ? failure.error : MESSAGES.notDraft, fieldErrors: {} };
    case "not_found":
      return { message: MESSAGES.notFound, fieldErrors: {} };
    default:
      return { message: failure.error, fieldErrors: {} };
  }
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
