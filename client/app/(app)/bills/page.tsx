import type { Metadata } from "next";
import { BillsList } from "./bills-list";
import { BillsProvider } from "./bills-provider";

export const metadata: Metadata = {
  title: "Bills",
};

// The bills list (DC-73). The bill form (DC-74) and the page's two-panel layout (DC-75)
// come later; the form refreshes this list through BillsProvider. proxy.ts sends
// signed-out visits to /login.
export default function BillsPage() {
  return (
    <>
      <h1 className="text-heading">Bills</h1>
      <BillsProvider>
        <BillsList />
      </BillsProvider>
    </>
  );
}
