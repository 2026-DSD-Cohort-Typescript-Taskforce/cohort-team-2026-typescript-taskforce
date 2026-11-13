'use client';

// The Bills page's left column, chosen by the open panel: the upload card by default, the
// Enter Bill Details form after "+ Add a Bill", or the stored PDF of the draft whose fix
// form is open in Current issues, so the bill can be read while it's finished.

import { AddBillForm } from './add-bill-form';
import { BillDocumentPreview } from './bill-document-preview';
import { BillUploadCard } from './bill-upload-card';
import { useIntake } from './intake-provider';

/** Upload and preview, the Enter Bill Details form, or the PDF of the issue being fixed. */
export function LeftColumn() {
  const { panel } = useIntake();
  if (panel.kind === 'add') return <AddBillForm />;
  if (panel.kind === 'fix') return <BillDocumentPreview billId={panel.billId} />;
  return <BillUploadCard />;
}
