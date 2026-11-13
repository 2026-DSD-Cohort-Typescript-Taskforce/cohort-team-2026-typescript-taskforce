'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import { ErrorAlert, Spinner, colorTransition, focusRing, secondaryButton } from '../../app/ui';
import { canManageUsers } from '../../lib/roles';

type Profile = {
  name: string | null;
  email: string | null;
  role: string | null;
};

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-full bg-primary font-semibold text-on-primary"
    >
      {name[0]?.toUpperCase()}
    </span>
  );
}

export function SignedInUser() {
  const [user, setUser] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [open, setOpen] = useState(false);
  const cardId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Document listeners exist only while the card is open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    let active = true;
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (res.status === 401 || res.status === 403) {
          // Clear any leftover cookies first, or proxy.ts would send /login straight back here.
          await fetch('/api/auth/logout', { method: 'POST' });
          window.location.replace('/login');
          return;
        }
        if (!res.ok) throw new Error(`GET /api/auth/me returned ${res.status}`);
        const body = await res.json();
        if (active) setUser(body.user);
      } catch {
        if (active) setError('Could not load your account. Refresh the page to try again.');
      }
    }
    loadUser();
    return () => {
      active = false;
    };
  }, []);

  async function logOut() {
    setError('');
    setLoggingOut(true);
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        window.location.replace('/login');
        return;
      }
    } catch {}
    setError('Could not log out. Try again.');
    setLoggingOut(false);
  }

  if (!user) {
    return error ? (
      <ErrorAlert message={error} />
    ) : (
      <p role="status" className="text-body-sm text-secondary">
        Loading your account…
      </p>
    );
  }

  const name = user.name || user.email || '';

  // Closes when focus moves to something outside the wrapper (e.g. tabbing out). Ignored while
  // logging out: disabling the focused Logout button can blur it, which would hide the spinner.
  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (loggingOut) return;
    if (
      !(event.relatedTarget instanceof Node) ||
      !event.currentTarget.contains(event.relatedTarget)
    ) {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative" onBlur={open ? onBlur : undefined}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={cardId}
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center gap-3 rounded-button p-1 hover:bg-raised ${colorTransition} ${focusRing}`}
      >
        <Avatar name={name} />
        <span aria-hidden="true" className="hidden min-w-0 flex-col text-right sm:flex">
          <span className="truncate text-body-sm font-semibold">{name}</span>
          {user.name && user.email && (
            <span className="truncate text-caption text-secondary">{user.email}</span>
          )}
        </span>
        <span className="sr-only">Account menu for {name}</span>
      </button>

      {open && (
        <div
          id={cardId}
          className="absolute top-full right-0 z-20 mt-2 flex w-72 flex-col gap-4 rounded-card bg-overlay p-6 shadow-l4"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={name} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-body-sm font-semibold">{name}</span>
              {user.name && user.email && (
                <span className="truncate text-caption text-secondary">{user.email}</span>
              )}
            </div>
          </div>
          {canManageUsers(user.role) && (
            <Link
              href="/users"
              onClick={() => setOpen(false)}
              className={`rounded-button px-3 py-2 text-body-sm font-semibold hover:bg-raised ${colorTransition} ${focusRing}`}
            >
              Manage Users
            </Link>
          )}
          <ErrorAlert message={error} />
          <button
            type="button"
            onClick={logOut}
            disabled={loggingOut}
            data-pending={loggingOut || undefined}
            className={`${secondaryButton} h-10! px-4!`}
          >
            {loggingOut && <Spinner />}
            {loggingOut ? 'Logging out…' : 'Logout'}
          </button>
        </div>
      )}
    </div>
  );
}
