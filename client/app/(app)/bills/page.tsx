import type { Metadata } from "next";
import { BillUploadCard } from "./bill-upload-card";
import { BillsList } from "./bills-list";
import { BillsProvider } from "./bills-provider";

export const metadata: Metadata = {
  title: "Bills",
};

// FigJam "Bill Intake \"Pay Bill\"" (node 143:2287). Upload sits on the left and the
// bills list sits on the right. proxy.ts sends signed-out visits to /login.
export default function BillsPage() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <h1 className="text-heading lg:col-span-2">Bills</h1>
      <BillUploadCard />
      <section aria-label="Bills" className="min-w-0">
        <BillsProvider>
          <BillsList />
        </BillsProvider>
      </section>
    </div>
  );
}
