import type { Metadata } from "next";
import { BillUploadCard } from "./bill-upload-card";
import { BillsList } from "./bills-list";
import { BillsProvider } from "./bills-provider";
import { FailedExtractions } from "./failed-extractions";

export const metadata: Metadata = {
  title: "Bills",
};

// FigJam "Bill Intake \"Pay Bill\"" (node 143:2287). Upload sits on the left and the
// bills list sits on the right. proxy.ts sends signed-out visits to /login.
export default function BillsPage() {
  return (
<div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">      
  <h1 className="text-heading lg:col-span-2">Bills</h1>
      <BillUploadCard />
      <div className="flex min-h-0 min-w-0 flex-col gap-6 lg:overflow-hidden">
        <section aria-label="Bills" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <BillsProvider>
            <BillsList />
          </BillsProvider>
        </section>
        <FailedExtractions issues={[]} />
      </div>
    </div>
  );
}
