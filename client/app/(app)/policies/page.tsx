import type { Metadata } from "next";
import { PoliciesList } from "./policies-list";

export const metadata: Metadata = {
  title: "Policies",
};

// The vendor policies page (DC-85): everyone signed in can read it; financial approvers and
// system admins can add, edit and switch policies on or off. The data loads in the browser,
// so the page itself is static. proxy.ts sends signed-out visits to /login.
export default function PoliciesPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 lg:p-6">
      <PoliciesList />
    </main>
  );
}
