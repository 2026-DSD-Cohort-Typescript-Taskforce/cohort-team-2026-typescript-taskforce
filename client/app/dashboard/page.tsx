import { Suspense } from 'react';
import { SiteFooter } from '../../components/layout/brand';
// import { Sidebar } from '@/components/layout/sidebar';
import { BillAccountsCard } from './BillAccountsCard';
import { PendingApprovalsTable, RecentPaymentsTable } from './BillTables';
import { InfoCard } from '@/components/ui/InfoCard';
import { LastSubmittedCard } from './LastSubmittedCard';

export default function MainDashboard() {
  return (
    <div className="flex flex-1">
      {/* <Sidebar /> */}
      <div className="flex flex-1 flex-col">
        <main className="flex w-full flex-1 flex-col gap-6 p-4 lg:p-6">
          <h1 className="text-heading">Overview</h1>
          <div className="grid gap-14 md:grid-cols-2">
            <Suspense fallback={<InfoCard title="Last Submitted" />}>
              <LastSubmittedCard />
            </Suspense>
            <Suspense fallback={<InfoCard title="Bill Accounts" />}>
              <BillAccountsCard />
            </Suspense>
          </div>
          <div className="grid items-start gap-14 lg:grid-cols-2">
            <Suspense fallback={<p>Loading...</p>}>
              <RecentPaymentsTable />
            </Suspense>
            <Suspense fallback={<p>Loading...</p>}>
              <PendingApprovalsTable />
            </Suspense>
          </div>
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
