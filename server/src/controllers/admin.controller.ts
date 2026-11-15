import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { roleSchema } from '../config/roles';
import { HttpError } from '../middleware/errorHandler';
import { emailInUse, sendInvite } from '../services/auth.service';

// Ids are Postgres integer columns; a bigger number would fail in the database as a 500.
const idSchema = z.number().int().positive().max(2_147_483_647);

// users.name, email and phone are varchar(255).
const newUserSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
  phone: z.string().trim().max(255).optional(),
  role: roleSchema,
  propertyIds: z.array(idSchema).default([]),
});

// Invite links open the client's Set Password page with the new session in the URL fragment.
const setPasswordUrl = () => `${env.CLIENT_URL}/set-password`;

/** Maps invite_user()'s errors (supabase/migrations/20261115000000_invite_users.sql). */
function inviteError(error: { code?: string; message?: string }) {
  switch (error.code) {
    case 'PT409':
      if (error.message === 'login_exists') {
        return new HttpError(
          409,
          "That email already has a login that isn't linked to a user. Delete that login in Supabase (Authentication → Users), then add the user again.",
          'login_exists',
        );
      }
    // falls through
    case '23505':
      return emailInUse();
    case '23503':
      return new HttpError(
        400,
        'One of the chosen properties no longer exists. Reload and try again.',
        'unknown_property',
      );
    case 'PT403':
      return new HttpError(403, "You don't have access to this.", 'forbidden');
    default:
      return error;
  }
}

/**
 * Adds a pending profile with the admin's own session (invite_user checks the role again),
 * then emails the invite. The profile stays if the email fails: `inviteSent` says so, and
 * the admin can resend.
 */
export async function inviteUser(req: Request, res: Response) {
  const parsed = newUserSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Check the user's details.");
  const { name, email, phone, role, propertyIds } = parsed.data;

  const { data: user, error } = await req.auth!.supabase.rpc('invite_user', {
    p_name: name,
    p_email: email,
    p_phone: phone ?? null,
    p_role: role,
    p_property_ids: propertyIds,
  });
  if (error) throw inviteError(error);

  const inviteSent = await sendInvite(user.email, setPasswordUrl()).then(
    () => true,
    () => false,
  );
  res.status(201).json({ user, inviteSent });
}

/** Emails a user a new invite link, for one that expired or never arrived. */
export async function resendInvite(req: Request, res: Response) {
  const userId = Number(req.params.id);
  const notFound = new HttpError(404, 'That user no longer exists.');
  if (!idSchema.safeParse(userId).success) throw notFound;

  const { data, error } = await req
    .auth!.supabase.from('users')
    .select('email')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.email) throw notFound;

  await sendInvite(data.email, setPasswordUrl());
  res.status(202).json({ message: `Invite sent to ${data.email}.` });
}
