import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { acceptChange, acceptSchema, getChange, listChanges, rejectChange } from '../controllers/change.controller.js';

const router = Router();
const idParam = z.object({ id: z.string().length(24) });

router.use(requireAuth);

router.get('/', listChanges);
router.get('/:id', validate({ params: idParam }), getChange);
router.post('/:id/accept', writeLimiter, validate({ params: idParam, body: acceptSchema }), acceptChange);
router.post('/:id/reject', validate({ params: idParam }), rejectChange);

export default router;
