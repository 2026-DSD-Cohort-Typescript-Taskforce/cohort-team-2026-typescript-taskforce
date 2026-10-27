import { Router } from "express";
import { login, logout, me } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/requireAuth";

// No sign-up route: logins are created by an admin or the local seed script.
const router = Router();

router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.post("/login", login);
router.post("/logout", logout);
router.get("/me", requireAuth, me);

export default router;
