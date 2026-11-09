import { Suspense } from 'react';
import { InfoCard } from '@/components/ui/InfoCard';
import { BillAccountsCard } from './dashboard/BillAccountsCard';
import { LastSubmittedCard } from './dashboard/LastSubmittedCard';

// Placeholder home until the app has real pages. proxy.ts sends signed-out visits to /login.
export default function Home() {
  return (
    <main className="w-full max-w-4xl self-center p-4 lg:p-6">
      <h1 className="mb-4 text-heading">Overview</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Suspense fallback={<InfoCard title="Last Submitted" />}>
          <LastSubmittedCard />
        </Suspense>
        <Suspense fallback={<InfoCard title="Bill Accounts" />}>
          <BillAccountsCard />
        </Suspense>
      </div>
    </main>
  );
}
