'use client';

import { useEffect, useState } from 'react';
import { ErrorAlert, Spinner, secondaryButton } from '../../app/ui';

type Profile = {
  name: string | null;
  email: string | null;
};

export function SignedInUser() {
  const [user, setUser] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

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

  return (
    <div className="flex items-center gap-3">
      <ErrorAlert message={error} />
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-full bg-primary font-semibold text-on-primary"
      >
        {name[0]?.toUpperCase()}
      </span>
      <div className="hidden min-w-0 flex-col text-right sm:flex">
        <span className="truncate text-body-sm font-semibold">{name}</span>
        {user.name && user.email && (
          <span className="truncate text-caption text-secondary">{user.email}</span>
        )}
      </div>
      <span className="sr-only sm:hidden">Signed in as {name}</span>
      <button
        type="button"
        onClick={logOut}
        disabled={loggingOut}
        data-pending={loggingOut || undefined}
        className={`${secondaryButton} h-10! px-4!`}
      >
        {loggingOut && <Spinner />}
        {loggingOut ? 'Logging out…' : 'Log out'}
      </button>
    </div>
  );
}
