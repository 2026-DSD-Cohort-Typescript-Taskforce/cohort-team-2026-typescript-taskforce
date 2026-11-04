import { APP_NAME, Logo, SiteFooter } from './brand';
import { SignedInUser } from './signed-in-user';
import { Suspense } from 'react';
import { BillAccountsCard } from './overview/BillAccountsCard';
import { InfoCard } from './overview/InfoCard';
import { LastSubmittedCard } from './overview/LastSubmittedCard';

// Placeholder home until the app has real pages. proxy.ts sends signed-out visits to /login.
export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <section
        aria-labelledby="overview-heading"
        className="w-full max-w-4xl self-center p-4 lg:p-6"
      >
        <h2 id="overview-heading" className="mb-4 text-heading">
          Overview
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Suspense fallback={<InfoCard title="Last Submitted" />}>
            <LastSubmittedCard />
          </Suspense>
          <Suspense fallback={<InfoCard title="Bill Accounts" />}>
            <BillAccountsCard />
          </Suspense>
        </div>
      </section>
      <main className="flex flex-1 items-center justify-center p-4 lg:p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-card border border-subtle bg-surface p-8 text-center sm:p-12">
          <Logo className="size-12" />
          <h1 className="text-heading">{APP_NAME}</h1>
          <SignedInUser />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
