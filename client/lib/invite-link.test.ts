import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LINK_EXPIRED,
  LINK_INCOMPLETE,
  PASSWORD_MISMATCH,
  PASSWORD_LENGTH,
  checkNewPassword,
  readInviteLink,
} from './invite-link.ts';

test('readInviteLink reads the session Supabase Auth puts in the fragment', () => {
  assert.deepEqual(
    readInviteLink(
      '#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer&type=signup',
    ),
    { ok: true, accessToken: 'a.b.c', refreshToken: 'r1' },
  );
});

test('readInviteLink reports an expired or used link', () => {
  assert.deepEqual(
    readInviteLink(
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    ),
    { ok: false, error: LINK_EXPIRED },
  );
});

test('readInviteLink reports a link with no session', () => {
  for (const hash of ['', '#', '#access_token=a.b.c', '#refresh_token=r1']) {
    assert.deepEqual(readInviteLink(hash), { ok: false, error: LINK_INCOMPLETE }, hash);
  }
});

test('checkNewPassword accepts 8 to 72 characters typed twice', () => {
  assert.equal(checkNewPassword('12345678', '12345678'), '');
  assert.equal(checkNewPassword('x'.repeat(72), 'x'.repeat(72)), '');
});

test('checkNewPassword refuses a short or long password, then a mismatch', () => {
  assert.equal(checkNewPassword('1234567', '1234567'), PASSWORD_LENGTH);
  assert.equal(checkNewPassword('x'.repeat(73), 'x'.repeat(73)), PASSWORD_LENGTH);
  assert.equal(checkNewPassword('12345678', '12345679'), PASSWORD_MISMATCH);
});
