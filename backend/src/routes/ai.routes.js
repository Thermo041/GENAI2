import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { aiLimiter, heavyAiLimiter } from '../middleware/rateLimit.js';
import {
  chat,
  chatSchema,
  generateChange,
  generateChangeSchema,
  getRepositoryConversation,
  impactAnalysis,
  impactSchema,
  listRepositoryConversations,
} from '../controllers/ai.controller.js';

const router = Router();

router.use(requireAuth);

router.post('/chat', aiLimiter, validate({ body: chatSchema }), chat);
router.post('/impact-analysis', aiLimiter, validate({ body: impactSchema }), impactAnalysis);
router.post('/generate-change', heavyAiLimiter, validate({ body: generateChangeSchema }), generateChange);

const conversationQuery = z.object({
  owner: z.string().min(1).max(39),
  repo: z.string().min(1).max(100),
  conversationId: z.string().length(24).optional(),
});

router.get('/conversations', validate({ query: conversationQuery }), listRepositoryConversations);
router.get('/conversation', validate({ query: conversationQuery }), getRepositoryConversation);

export default router;
