import { DataTable, type Column } from '@/components/data-table';
import { SiteFooter } from '../brand';

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
      <main className="flex w-3xl flex-1 flex-col gap-6 p-4 lg:p-6">
        <h1 className="text-heading">Main Dashboard</h1>
        <DataTable title="Recent Payments" columns={columns} rows={tasks2} />
      </main>
      <SiteFooter />
    </div>
  );
}
