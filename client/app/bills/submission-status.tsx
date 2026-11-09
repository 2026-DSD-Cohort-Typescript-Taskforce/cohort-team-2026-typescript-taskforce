import type { SubmissionState } from "@/lib/bill-submission";
import { ErrorAlert, Spinner, SuccessAlert } from "../ui";

/**
 * The bill form's save and submit feedback (DC-76), from useBillSubmission(): a busy line
 * while a request runs, then a success or an error. Each live region stays mounted, so
 * screen readers announce every new message.
 */
export function SubmissionStatus({
  state,
  message,
  className = "",
}: {
  state: SubmissionState;
  message: string;
  className?: string;
}) {
  const busy = state === "saving" || state === "submitting";
  const success = state === "saved" || state === "submitted";
  // partial: the draft was saved, but submit_bill() refused it.
  const failed = state === "error" || state === "partial";

  return (
    <div className={className}>
      <div role="status">
        {busy && (
          <p className="flex items-center gap-2 text-body-sm text-secondary">
            <Spinner />
            {message}
          </p>
        )}
      </div>
      <SuccessAlert message={success ? message : ""} />
      <ErrorAlert message={failed ? message : ""} />
    </div>
  );
}
