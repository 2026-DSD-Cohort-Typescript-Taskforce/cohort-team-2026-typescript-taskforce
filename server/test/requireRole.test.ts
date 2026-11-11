// Unit tests for requireRole. No network or database: req.auth.supabase is a fake.
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { Request, Response } from 'express';
import type { AuthContext } from '../src/middleware/requireAuth';
import { HttpError } from '../src/middleware/errorHandler';
import { requireRole } from '../src/middleware/requireRole';
import type { Profile } from '../src/services/users.service';

function profileWithRole(role: string | null): Profile {
  return { user_id: 1, name: 'Test User', email: 'test@example.com', role, property_id: null };
}

/** A fake supabase client whose users lookup resolves to `profile`. */
function fakeSupabase(profile: Profile | null): AuthContext['supabase'] {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: profile, error: null }),
  };
  return { from: () => query } as unknown as AuthContext['supabase'];
}

function fakeRequest(profile: Profile | null): Request {
  const auth = {
    user: { id: 'auth-user-id' },
    accessToken: 'token',
    supabase: fakeSupabase(profile),
  } as unknown as AuthContext;
  return { auth } as unknown as Request;
}

async function run(req: Request, ...roles: Parameters<typeof requireRole>) {
  const next = mock.fn();
  await requireRole(...roles)(req, {} as Response, next);
  return next;
}

async function assertRejects(promise: Promise<unknown>, status: number, code?: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });
}

describe('requireRole', () => {
  it('calls next when the role is allowed', async () => {
    const next = await run(
      fakeRequest(profileWithRole('system_administrator')),
      'system_administrator',
    );
    assert.equal(next.mock.callCount(), 1);
  });

  it('rejects another valid role with 403 forbidden', async () => {
    await assertRejects(
      run(fakeRequest(profileWithRole('billing_operator')), 'system_administrator'),
      403,
      'forbidden',
    );
  });

  it('rejects an unknown role with 403 forbidden', async () => {
    await assertRejects(
      run(fakeRequest(profileWithRole('superuser')), 'system_administrator'),
      403,
      'forbidden',
    );
  });

  it('rejects a null role with 403 forbidden', async () => {
    await assertRejects(
      run(fakeRequest(profileWithRole(null)), 'system_administrator'),
      403,
      'forbidden',
    );
  });

  it('rejects a login with no profile with 403 profile_not_found', async () => {
    await assertRejects(run(fakeRequest(null), 'system_administrator'), 403, 'profile_not_found');
  });

  it('rejects a request with no req.auth with 401', async () => {
    await assertRejects(run({} as Request, 'system_administrator'), 401);
  });
});
