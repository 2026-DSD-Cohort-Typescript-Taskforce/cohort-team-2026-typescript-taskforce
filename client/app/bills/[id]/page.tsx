import type { Metadata } from "next";
import { Suspense } from "react";
import { BillDetails } from "./bill-details";

export const metadata: Metadata = {
  title: "Bill",
};

// The View Bill page (Figma 837:5895). The id is only known per request, so it is read
// inside Suspense (cacheComponents). proxy.ts sends signed-out visits to /login.
export default function BillPage({ params }: PageProps<"/bills/[id]">) {
  return (
    <Suspense
      fallback={
        <p role="status" className="text-body text-secondary">
          Loading the bill…
        </p>
      }
    >
      {params.then(({ id }) => (
        <BillDetails id={id} />
      ))}
    </Suspense>
  );
}
