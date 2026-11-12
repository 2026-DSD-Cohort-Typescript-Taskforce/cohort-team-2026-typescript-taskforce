import type { Metadata } from "next";
import { VendorsDirectory } from "./vendors-directory";

export const metadata: Metadata = {
  title: "Vendors",
};

// The vendors grid (DC-84): everyone signed in can read it; financial approvers and system
// admins can add, edit and delete. The data loads in the browser, so the page itself is
// static. proxy.ts sends signed-out visits to /login.
export default function VendorsPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 lg:p-6">
      <VendorsDirectory />
    </main>
  );
}
