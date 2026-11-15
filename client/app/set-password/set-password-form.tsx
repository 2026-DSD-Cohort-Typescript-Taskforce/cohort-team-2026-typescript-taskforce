'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { checkNewPassword, readInviteLink, type InviteLink } from '@/lib/invite-link';
import { ErrorAlert, Spinner, colorTransition, focusRing, primaryButton } from '../ui';

const inputClass = `h-12 w-full rounded-input border border-strong bg-background px-4 text-body text-foreground focus-visible:border-primary aria-invalid:border-danger ${colorTransition} ${focusRing}`;

export function SetPasswordForm() {
  /** null until the fragment has been read, which only the browser can do. */
  const [link, setLink] = useState<InviteLink | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // The fragment holds the session's tokens: read it once, then drop it from the address
    // bar and history. It exists only in the browser, so it can't be read while rendering
    // without the server and client renders differing. Strict Mode (dev) runs this twice and
    // the second run finds the fragment gone, so the first reading is kept.
    const found = readInviteLink(window.location.hash);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above.
    setLink((current) => current ?? found);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !link?.ok) return;
    // Clear first so the same message is announced again on a repeat failure.
    setError('');
    const problem = checkNewPassword(password, confirmation);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    try {
      // Plain fetch, not apiFetch: a 401 here is an expired link to explain, not a session
      // to refresh.
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accessToken: link.accessToken,
          refreshToken: link.refreshToken,
          password,
        }),
      });
      if (res.ok) {
        // A full page load, so proxy.ts sees the new session cookies.
        window.location.replace('/dashboard');
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.error ?? 'Something went wrong. Try again.');
    } catch {
      setError('Could not reach the server. Try again.');
    }
    setSubmitting(false);
  }

  if (!link) {
    return (
      <p role="status" className="mt-8 text-body text-secondary">
        Loading…
      </p>
    );
  }

  if (!link.ok) {
    return (
      <div className="mt-8 flex flex-col gap-6">
        <ErrorAlert message={link.error} />
        <Link href="/login" className={`w-full ${primaryButton}`}>
          Go to sign in
        </Link>
      </div>
    );
  }

  const describedBy = error ? 'set-password-error' : undefined;
  const fields = [
    { id: 'new-password', label: 'New password', value: password, set: setPassword },
    {
      id: 'confirm-password',
      label: 'Confirm password',
      value: confirmation,
      set: setConfirmation,
    },
  ];

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-6">
      {fields.map(({ id, label, value, set }) => (
        <div key={id} className="flex flex-col gap-2">
          <label htmlFor={id} className="text-body-sm font-medium">
            {label}
          </label>
          <input
            id={id}
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            value={value}
            onChange={(event) => set(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={inputClass}
          />
        </div>
      ))}
      <p className="-mt-3 text-body-sm text-secondary">At least 8 characters.</p>

      {/* The alert's box brings its own margin, so no gap is left when there is no error. */}
      <div className="flex flex-col">
        <ErrorAlert id="set-password-error" message={error} className="mb-6" />
        <button
          type="submit"
          disabled={submitting}
          data-pending={submitting || undefined}
          className={`w-full ${primaryButton}`}
        >
          {submitting && <Spinner />}
          {submitting ? 'Saving…' : 'Set password and sign in'}
        </button>
      </div>
    </form>
  );
}
