'use client';

// Shows a stored bill document in the left column while its draft is fixed. The bucket is
// private, so the PDF loads through a link that only works for a few minutes, fetched
// from GET /api/bills/[id]/document each time a bill is opened.

import { useEffect, useState } from 'react';
import { loadDocumentUrl } from '@/lib/bill-api';
import { ErrorAlert } from '@/app/ui';

/** The PDF of the bill being fixed, through a link that works for a few minutes. */
export function BillDocumentPreview({ billId }: { billId: number }) {
  const [loaded, setLoaded] = useState<{ billId: number; url?: string; error?: string } | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    loadDocumentUrl(billId).then((result) => {
      if (!active || !result) return;
      setLoaded(result.ok ? { billId, url: result.data } : { billId, error: result.error });
    });
    return () => {
      active = false;
    };
  }, [billId]);

  const current = loaded?.billId === billId ? loaded : null;
  return (
    <section
      aria-label="Bill PDF"
      className="flex h-full min-h-0 flex-col gap-4 rounded-card border border-subtle bg-surface p-4"
    >
      <h2 className="text-body-lg font-semibold">Bill PDF</h2>
      {current?.url ? (
        <iframe
          title="Bill PDF"
          src={current.url}
          className="min-h-0 w-full flex-1 rounded-input bg-background"
        />
      ) : current?.error ? (
        <ErrorAlert message={current.error} />
      ) : (
        <p className="text-body-sm text-secondary">Loading the PDF…</p>
      )}
    </section>
  );
}
