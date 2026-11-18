// The Bills page. The left column is the upload card, the Enter Bill Details form, or the
// PDF of the draft being fixed; the right column splits its height evenly between My Bills
// and Current issues. BillsProvider loads the bills once for both columns, and
// IntakeProvider tracks which panel is open, so an upload or a fix refreshes the list.

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BillsList } from './bills-list';
import { BillsProvider } from './bills-provider';
import { CurrentIssues } from './failed-extractions';
import { IntakeProvider } from './intake-provider';
import { LeftColumn } from './left-column';

export const metadata: Metadata = {
  title: 'Bills',
};

// FigJam "Bill Intake \"Pay Bill\"" (node 143:2287). Upload or the bill form on the left,
// the bills list and Current issues on the right. proxy.ts sends signed-out visits to /login.
export default function BillsPage() {
  return (
    <BillsProvider>
      {/* IntakeProvider reads ?fix= with useSearchParams, which needs a Suspense boundary. */}
      <Suspense>
        <IntakeProvider>
          <div className="grid min-h-0 flex-1 content-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
            <h1 className="text-heading lg:col-span-2">Bills</h1>
            <LeftColumn />
            <div className="flex min-h-0 min-w-0 flex-col gap-6 lg:overflow-hidden">
              <section
                aria-label="Bills"
                className="flex min-h-0 flex-1 flex-col overflow-hidden lg:basis-0"
              >
                <BillsList />
              </section>
              <CurrentIssues />
            </div>
          </div>
        </IntakeProvider>
      </Suspense>
    </BillsProvider>
  );
}
