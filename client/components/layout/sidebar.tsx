'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useState } from 'react';
import { colorTransition, focusRing } from '../../app/ui';
import { APP_NAME, Logo } from './brand';

// 24x24 stroke icon paths. '#' links are placeholders until those pages exist.
const links = [
  { href: '/bills', label: 'Bills', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3' },
  {
    href: '/dashboard',
    label: 'Overview',
    icon: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  },
  { href: '#', label: 'Accounts', icon: 'M3 9l9-5 9 5M5 9v9M10 9v9M14 9v9M19 9v9M3 20h18' },
  { href: '#', label: 'Approvals', icon: 'M4 12l5 5L20 6' },
  { href: '/policies', label: 'Policies', icon: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z' },
  {
    href: '#',
    label: 'Settings',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  },
];

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5 shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

function ActiveNavLinks({ label }: { label: string }) {
  return <NavLinks label={label} pathname={usePathname()} />;
}

function NavLinks({ label, pathname }: { label: string; pathname: string | null }) {
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
      {links.map((l) => {
        const active = l.href === pathname;
        return (
          <Link
            key={l.label}
            href={l.href}
            title={l.label}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-input px-3 py-2 text-body-sm whitespace-nowrap ${
              active
                ? 'bg-raised font-semibold text-primary'
                : 'text-secondary hover:bg-raised hover:text-foreground'
            } ${colorTransition} ${focusRing}`}
          >
            <Icon d={l.icon} />
            <span className={label}>{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  // null = not toggled yet: CSS picks an icon rail on small screens and the full sidebar from md up.
  const [collapsed, setCollapsed] = useState<boolean | null>(null);

  function toggle() {
    setCollapsed((c) => !(c ?? !window.matchMedia('(min-width: 48rem)').matches));
  }

  const width = collapsed === null ? 'w-16 md:w-56' : collapsed ? 'w-16' : 'w-56';
  const label = collapsed === null ? 'sr-only md:not-sr-only' : collapsed ? 'sr-only' : '';

  return (
    <aside
      className={`sticky top-0 flex h-dvh shrink-0 flex-col gap-6 overflow-hidden border-r border-subtle bg-surface p-3 motion-safe:transition-[width] ${width}`}
    >
      <div className="flex items-center gap-2 px-1">
        <Logo className="size-8" />
        <span className={`font-semibold whitespace-nowrap ${label}`}>{APP_NAME}</span>
      </div>
      {/* usePathname is request-time data, so only the links wait on it (cacheComponents). */}
      <Suspense fallback={<NavLinks label={label} pathname={null} />}>
        <ActiveNavLinks label={label} />
      </Suspense>
      <button
        type="button"
        onClick={toggle}
        aria-label="Toggle sidebar"
        aria-expanded={collapsed === null ? undefined : !collapsed}
        className={`flex items-center gap-3 rounded-input px-3 py-2 text-body-sm text-secondary hover:bg-raised hover:text-foreground ${colorTransition} ${focusRing}`}
      >
        <Icon d="M4 4h16v16H4zM9 4v16" />
      </button>
    </aside>
  );
}
