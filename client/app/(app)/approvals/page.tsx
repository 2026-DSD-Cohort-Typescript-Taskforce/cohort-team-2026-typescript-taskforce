import type { Metadata } from "next";
import { ApprovalsQueue } from "./approvals-queue";

export const metadata: Metadata = {
  title: "Approvals",
};

// The approvals queue (DC-81): bills waiting for a financial approver's decision. The data
// loads in the browser, so the page itself is static. proxy.ts sends signed-out visits to /login.
export default function ApprovalsPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 lg:p-6">
      <ApprovalsQueue />
    </main>
  );
}
