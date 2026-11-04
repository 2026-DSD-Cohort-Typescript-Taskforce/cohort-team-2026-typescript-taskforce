import { Suspense } from 'react';
import { SiteFooter } from '../../components/layout/brand';
import { Sidebar } from '@/components/layout/sidebar';
import { DataTable, type Column } from '@/components/ui/data-table';
import { BillAccountsCard } from './BillAccountsCard';
import { InfoCard } from '@/components/ui/InfoCard';
import { LastSubmittedCard } from './LastSubmittedCard';

type Task = { name: string; owner?: string; status?: string; due?: string };

// Placeholder rows until the dashboard is wired to the API.
const tasks: Task[] = [
  { name: 'Set up database', owner: 'Ana', status: 'Done', due: '2026-11-02' },
  { name: 'Build login page', owner: 'Ben', status: 'In progress', due: '2026-11-09' },
  { name: 'Dashboard table', owner: 'Mclean', status: 'In progress', due: '2026-11-06' },
  { name: 'Write API docs', owner: 'Cleo', status: 'To do', due: '2026-11-16' },
];

const columns: Column<Task>[] = [
  { key: 'name', label: 'Task' },
  { key: 'owner', label: 'Owner' },
  { key: 'status', label: 'Status' },
  { key: 'due', label: 'Due' },
];

const tasks2: Task[] = [
  { name: 'Bill 1' },
  { name: 'Bill 2' },
  { name: 'Bill 3' },
  { name: 'Bill 4' },
];

export default function MainDashboard() {
  return (
    <div className="flex flex-1">
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
              <DataTable title="Recent Payments" columns={columns} rows={tasks2} />
            </Suspense>
            <Suspense fallback={<p>Loading...</p>}>
              <DataTable title="Pending Approvals" columns={columns} rows={tasks2} />
            </Suspense>
          </div>
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
