import type { RequestHandler } from 'express';
import { isRole, type Role } from '../config/roles';
import { getProfileByAuthUserId } from '../services/users.service';
import { HttpError } from './errorHandler';

/** Use after requireAuth. */
export function requireRole(...roles: Role[]): RequestHandler {
  return async (req, _res, next) => {
    if (!req.auth) throw new HttpError(401, 'You are not signed in.');

    const profile = await getProfileByAuthUserId(req.auth.supabase, req.auth.user.id);
    if (!profile) {
      throw new HttpError(
        403,
        'No app profile is linked to this login. Ask an admin to set one up.',
        'profile_not_found',
      );
    }

    if (!isRole(profile.role) || !roles.includes(profile.role)) {
      throw new HttpError(403, "You don't have access to this.", 'forbidden');
    }

    next();
  };
}
