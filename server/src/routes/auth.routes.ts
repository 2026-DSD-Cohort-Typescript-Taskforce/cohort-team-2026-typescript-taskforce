import { Router } from 'express';
import { changeEmail, login, logout, me, setPassword } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/requireAuth';

// No sign-up route: logins come from an admin's invite (/api/admin/users) or the local seed
// script.
const router = Router();

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.post('/login', login);
router.post('/logout', logout);
router.post('/set-password', setPassword);
router.get('/me', requireAuth, me);
router.patch('/email', requireAuth, changeEmail);

export default router;
