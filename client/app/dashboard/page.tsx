import { SiteFooter } from '../brand';
import { TanstackDataTable, type Column } from '@/components/data-table-tanstack';

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
    <div className="flex flex-1 flex-col">
      <main className="flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 lg:p-6">
        <h1 className="text-heading">Main Dashboard</h1>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <TanstackDataTable title="Pending Approvals" columns={columns} rows={tasks2} />
          <TanstackDataTable title="Recent Payments" columns={columns} rows={tasks2} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
