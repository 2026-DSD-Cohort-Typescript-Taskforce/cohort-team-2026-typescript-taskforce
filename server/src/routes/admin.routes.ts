import { Router } from 'express';
import { inviteUser, resendInvite } from '../controllers/admin.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';

// System admin only (DC-55).
const router = Router();

router.use(requireAuth, requireRole('system_admin'));

router.post('/users', inviteUser);
router.post('/users/:id/invite', resendInvite);

export default router;
