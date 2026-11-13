// The browser's calls for the Users page (DC-55), through the same `call` as the bill
// routes. Each returns the data, a failure with a readable message, or null while
// apiFetch sends the user to /login.

import { call, type ApiResult } from './bill-api';
import { LOAD_USERS_FAILED, type NewUserInput, type UserRecord } from './user-directory';

export function loadUsers() {
  return call(
    '/api/users',
    undefined,
    (body: { users: UserRecord[] }) => body.users,
    LOAD_USERS_FAILED,
  );
}

// Temporary ids for mocked users: negative, so they never clash with a real user_id.
let nextMockId = -1;

/**
 * MOCK: nothing is saved. Waits 500 ms, then answers with the user as the endpoint will,
 * with no login yet (auth_user_id null).
 *
 * TODO(DC-55): send the input to POST /api/admin/users (call + sendJson('POST', input),
 * fallback CREATE_USER_FAILED) and drop `propertyNames`: the endpoint returns the embed.
 *
 * @param propertyNames The chosen properties' names, which only the mock needs.
 */
export async function createUser(
  input: NewUserInput,
  propertyNames: string[] = [],
): Promise<ApiResult<UserRecord>> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  return {
    ok: true,
    data: {
      user_id: nextMockId--,
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone?.trim() || null,
      role: input.role,
      auth_user_id: null,
      properties: propertyNames.map((name) => ({ name })),
    },
  };
}
