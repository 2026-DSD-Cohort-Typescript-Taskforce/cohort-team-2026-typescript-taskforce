'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadUserRole } from '@/lib/bill-api';
import { canManageUsers } from '@/lib/roles';
import { loadUsers, resendInvite } from '@/lib/user-api';
import {
  USERS_FORBIDDEN,
  matchesUser,
  toUserRow,
  type UserRecord,
  type UserRow,
} from '@/lib/user-directory';
import { ErrorAlert, SuccessAlert, colorTransition, focusRing, primaryButton } from '@/app/ui';
import { LoadError } from '../bills/bills-list';
import { UserModal, type SaveNotice } from './user-modal';
import { UsersTable } from './users-table';

// As the vendor search (vendors-directory.tsx).
const searchClass = `h-12 w-full rounded-input border border-strong bg-background pr-4 pl-11 text-body text-foreground placeholder:text-secondary focus-visible:border-primary ${colorTransition} ${focusRing}`;

/** The Users table and the Add a User modal (DC-55). Only system admins see either. */
export function UsersDirectory() {
  /** null until the first load succeeds. */
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  /** null while the role loads; false if it isn't system_admin or didn't load. */
  const [canManage, setCanManage] = useState<boolean | null>(null);
  /** The open modal: { user } to edit that user, {} to add one, null when closed. */
  const [modal, setModal] = useState<{ user?: UserRecord } | null>(null);
  const [success, setSuccess] = useState('');
  /** An invite that couldn't be sent, from adding a user or resending, or a failed resend. */
  const [warning, setWarning] = useState('');
  /** The user whose invite is being resent. */
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const searchId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The button that opened the modal (Add a User or a user's name), which gets focus back
  // when the modal closes.
  const openerRef = useRef<HTMLButtonElement | null>(null);
  // Only the newest load's answer is shown, if reloads overlap.
  const latest = useRef(0);

  const load = useCallback(() => {
    const request = ++latest.current;
    loadUsers().then((result) => {
      // null: apiFetch is sending the user to /login.
      if (!result || request !== latest.current) return;
      if (result.ok) {
        setUsers(result.data);
        setLoadError('');
      } else {
        setLoadError(result.error);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Never assumed: nothing shows until the role says system_admin.
  useEffect(() => {
    let active = true;
    loadUserRole().then((result) => {
      if (active && result) setCanManage(result.ok && canManageUsers(result.data));
    });
    return () => {
      active = false;
    };
  }, []);

  const rows = useMemo(() => users?.map(toUserRow) ?? [], [users]);
  const shown = useMemo(() => rows.filter((row) => matchesUser(row, query)), [rows, query]);

  function reload() {
    setLoading(true);
    load();
  }

  function openModal(opener: HTMLButtonElement, user?: UserRecord) {
    // Cleared now, so the next save is announced even if it repeats the last one.
    setSuccess('');
    setWarning('');
    openerRef.current = opener;
    setModal({ user });
  }

  function edit(row: UserRow, opener: HTMLButtonElement) {
    const user = users?.find((record) => record.user_id === row.user_id);
    if (user) openModal(opener, user);
  }

  function closeModal() {
    setModal(null);
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
    else headingRef.current?.focus();
  }

  function saved({ text, warning }: SaveNotice) {
    if (warning) setWarning(text);
    else setSuccess(text);
    // The row shows with its properties as the list route reads them.
    load();
  }

  async function resend(row: UserRow) {
    if (resendingId !== null) return;
    setSuccess('');
    setWarning('');
    setResendingId(row.user_id);
    const result = await resendInvite(row.user_id);
    // null: apiFetch is sending the user to /login.
    if (!result) return;
    setResendingId(null);
    if (result.ok) setSuccess(result.data);
    else setWarning(result.error);
  }

  if (canManage === null) {
    return (
      <p role="status" className="text-body text-secondary">
        Loading…
      </p>
    );
  }

  if (!canManage) {
    return (
      <>
        <h1 className="text-heading">Users</h1>
        <div className="rounded-card border border-subtle bg-surface p-6 sm:p-8">
          <p className="text-body-lg font-medium">{USERS_FORBIDDEN}</p>
        </div>
      </>
    );
  }

  let content: ReactNode;
  if (!users) {
    content = loadError ? (
      <LoadError message={loadError} retrying={loading} onRetry={reload} />
    ) : (
      <p role="status" className="text-body text-secondary">
        Loading users…
      </p>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        {/* A failed reload keeps the table shown. */}
        {loadError && <LoadError message={loadError} retrying={loading} onRetry={reload} />}
        {users.length > 0 && (
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">
              Search users
            </label>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-secondary"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search users by name or email"
              autoComplete="off"
              className={searchClass}
            />
          </div>
        )}
        {shown.length === 0 ? (
          <div className="rounded-card border border-subtle bg-surface p-6 sm:p-8">
            <p className="text-body-lg font-medium">
              {users.length === 0 ? 'No users yet.' : `No users match “${query.trim()}”.`}
            </p>
          </div>
        ) : (
          <UsersTable rows={shown} onEdit={edit} onResend={resend} resendingId={resendingId} />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-3">
          {/* tabIndex -1: takes focus if the Add a User button is gone when the modal closes. */}
          <h1 ref={headingRef} tabIndex={-1} className="text-heading outline-none">
            Users
          </h1>
          {users && (
            // Announced as the search narrows the list.
            <p role="status" className="text-body text-secondary">
              {shown.length === rows.length
                ? `All (${rows.length})`
                : `${shown.length} of ${rows.length}`}
            </p>
          )}
        </div>
        {/* Hidden until the list has loaded. */}
        {users && (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={(event) => openModal(event.currentTarget)}
            className={primaryButton}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
              className="size-5"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add a User
          </button>
        )}
      </div>
      {/* The alert brings its own margin, so no gap is left while it is empty. */}
      <div className="flex flex-col">
        <SuccessAlert message={success} className="mb-6" />
        <ErrorAlert message={warning} className="mb-6" />
        {content}
      </div>
      {modal && <UserModal user={modal.user} onClose={closeModal} onSaved={saved} />}
    </>
  );
}
