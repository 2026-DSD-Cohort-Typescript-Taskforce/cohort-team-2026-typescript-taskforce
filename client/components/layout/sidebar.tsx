import Link from 'next/link';
import { APP_NAME, Logo } from './brand';

// Mockup only: links are placeholders, no active-state logic.
const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/bills', label: 'Bills' },
  { href: '#', label: 'Accounts' },
  { href: '#', label: 'Approvals' },
  { href: '#', label: 'Settings' },
];

export function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-6 border-r border-subtle bg-surface p-4 md:flex">
      <div className="flex items-center gap-2">
        <Logo className="size-8" />
        <span className="font-semibold">{APP_NAME}</span>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {links.map((l) => (
          <Link
            key={l.label}
            href={l.href}
            className="rounded-card px-3 py-2 text-sm hover:bg-black/5"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
