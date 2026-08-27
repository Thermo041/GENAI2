import { Router } from 'express';
import { authLimiter } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { githubCallback, logout, me, startGithubAuth, updatePreferences } from '../controllers/auth.controller.js';

const router = Router();

router.get('/github', authLimiter, startGithubAuth);
router.get('/github/callback', authLimiter, githubCallback);
router.get('/me', me);
router.post('/logout', requireAuth, logout);
router.patch(
  '/preferences',
  requireAuth,
  validate({ body: z.object({ theme: z.enum(['dark', 'light']) }) }),
  updatePreferences,
);

export default router;
