import { Router } from 'express';
import { inviteUser, resendInvite, updateUser } from '../controllers/admin.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';

// System admin only (DC-55).
const router = Router();

router.use(requireAuth, requireRole('system_admin'));

router.post('/users', inviteUser);
router.post('/users/:id/invite', resendInvite);
router.patch('/users/:id', updateUser);

export default router;
