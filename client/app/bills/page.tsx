import type { Metadata } from "next";
import { BillIntake } from "./bill-intake";
import { BillsList } from "./bills-list";
import { BillsProvider } from "./bills-provider";

export const metadata: Metadata = {
  title: "Bills",
};

// Pay Bill: add a bill by upload on the left, the bills list (DC-73) on the right.
// The entry form (DC-74) comes later. proxy.ts sends signed-out visits to /login.
export default function BillsPage() {
  return (
    <>
      <h1 className="text-heading">Bills</h1>
      <BillsProvider>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <BillIntake />
          <BillsList />
        </div>
      </BillsProvider>
    </>
  );
}
