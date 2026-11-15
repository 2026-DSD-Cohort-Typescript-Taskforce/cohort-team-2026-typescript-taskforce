// The browser's calls for the Users page (DC-55), through the same `call` as the bill
// routes. Each returns the data, a failure with a readable message, or null while
// apiFetch sends the user to /login.

import { call, sendJson } from './bill-api';
import {
  CREATE_USER_FAILED,
  LOAD_USERS_FAILED,
  RESEND_FAILED,
  UPDATE_USER_FAILED,
  type NewUserInput,
  type UserRecord,
} from './user-directory';

export function loadUsers() {
  return call(
    '/api/users',
    undefined,
    (body: { users: UserRecord[] }) => body.users,
    LOAD_USERS_FAILED,
  );
}

/** Adds a pending user and emails the invite. `inviteSent` is false if only the email failed. */
export function createUser(input: NewUserInput) {
  return call(
    '/api/admin/users',
    sendJson('POST', input),
    (body: { user: { email: string }; inviteSent: boolean }) => body,
    CREATE_USER_FAILED,
  );
}

export function resendInvite(userId: number) {
  return call(
    `/api/admin/users/${userId}/invite`,
    { method: 'POST' },
    (body: { message: string }) => body.message,
    RESEND_FAILED,
  );
}

/** Changes a user's name, phone, role and properties. The email can't be changed here. */
export function updateUser(userId: number, input: Omit<NewUserInput, 'email'>) {
  return call(
    `/api/admin/users/${userId}`,
    sendJson('PATCH', input),
    (body: { user: { name: string } }) => body.user,
    UPDATE_USER_FAILED,
  );
}
