// What extract-invoices answers, and the Current issues notices it leaves for this session.
// submitted and draft created a bill; confirm_replace waits for the user; duplicate,
// needs_review, rejected and failed saved nothing and become notices.
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

export type ExtractionOutcome =
  'submitted' | 'draft' | 'duplicate' | 'confirm_replace' | 'needs_review' | 'rejected' | 'failed';

export type ExtractionResult = {
  outcome: ExtractionOutcome;
  message: string;
  bill?: { bill_id: number; status: string };
};

export type Notice = {
  id: string;
  title: string;
  message: string;
  severity: 'warning' | 'error';
  billId?: number;
};

/** A notice for the outcomes that leave no draft to finish; null for the others. */
export function noticeFor(result: ExtractionResult, fileName: string): Omit<Notice, 'id'> | null {
  const billId = result.bill?.bill_id;
  switch (result.outcome) {
    case 'duplicate':
    case 'needs_review':
      return { title: fileName, message: result.message, severity: 'warning', billId };
    case 'rejected':
    case 'failed':
      return { title: fileName, message: result.message, severity: 'error', billId };
    default:
      return null;
  }
}
