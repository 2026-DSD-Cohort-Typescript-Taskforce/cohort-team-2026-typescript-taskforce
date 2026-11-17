// The Set Password page's checks (DC-55). An invite link signs the user in through Supabase
// Auth, which redirects to /set-password with the session, or an error, in the URL fragment.
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

export type InviteLink =
  { ok: true; accessToken: string; refreshToken: string } | { ok: false; error: string };

// The same words as Express's link_expired (server/src/services/auth.service.ts).
export const LINK_EXPIRED =
  'This link has expired or was already used. Ask an admin to send you a new invite.';
export const LINK_INCOMPLETE = 'This link is incomplete. Open the link in your invite email again.';
export const PASSWORD_LENGTH = 'Choose a password of 8 to 72 characters.';
export const PASSWORD_MISMATCH = "The passwords don't match.";

export function readInviteLink(hash: string): InviteLink {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  // Auth sends an error here only for a link it refused: expired or already used.
  if (params.has('error')) return { ok: false, error: LINK_EXPIRED };
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return { ok: false, error: LINK_INCOMPLETE };
  return { ok: true, accessToken, refreshToken };
}

/** The message to show, or '' when the password can be sent. Express checks the length again. */
export function checkNewPassword(password: string, confirmation: string): string {
  if (password.length < 8 || password.length > 72) return PASSWORD_LENGTH;
  if (password !== confirmation) return PASSWORD_MISMATCH;
  return '';
}
