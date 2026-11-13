'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadUserRole } from '@/lib/bill-api';
import { canManageUsers } from '@/lib/roles';
import { loadUsers } from '@/lib/user-api';
import { USERS_FORBIDDEN, inviteSent, toUserRow, type UserRecord } from '@/lib/user-directory';
import { SuccessAlert, primaryButton } from '@/app/ui';
import { LoadError } from '../bills/bills-list';
import { AddUserModal } from './add-user-modal';
import { UsersTable } from './users-table';

/** The Users table and the Add a User modal (DC-55). Only system admins see either. */
export function UsersDirectory() {
  /** null until the first load succeeds. */
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  /** null while the role loads; false if it isn't system_admin or didn't load. */
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [success, setSuccess] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The Add a User button, which gets focus back when the modal closes.
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

  function reload() {
    setLoading(true);
    load();
  }

  function openModal(opener: HTMLButtonElement) {
    // Cleared now, so the next invite is announced even if it repeats the last one.
    setSuccess('');
    openerRef.current = opener;
    setAdding(true);
  }

  function closeModal() {
    setAdding(false);
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
    else headingRef.current?.focus();
  }

  function created(user: UserRecord) {
    setUsers((current) => (current ? [...current, user] : [user]));
    setSuccess(inviteSent(user.email ?? ''));
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
        {users.length === 0 ? (
          <div className="rounded-card border border-subtle bg-surface p-6 sm:p-8">
            <p className="text-body-lg font-medium">No users yet.</p>
          </div>
        ) : (
          <UsersTable rows={rows} />
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
          {users && <p className="text-body text-secondary">All ({rows.length})</p>}
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
        {content}
      </div>
      {adding && <AddUserModal onClose={closeModal} onCreated={created} />}
    </>
  );
}
