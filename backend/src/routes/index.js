import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { activity, health } from '../controllers/system.controller.js';
import authRoutes from './auth.routes.js';
import githubRoutes from './github.routes.js';
import repositoryRoutes from './repository.routes.js';
import aiRoutes from './ai.routes.js';
import changeRoutes from './change.routes.js';

const router = Router();

router.get('/health', health);
router.get('/activity', requireAuth, activity);

router.use('/auth', authRoutes);
router.use('/github', githubRoutes);
router.use('/repositories', repositoryRoutes);
router.use('/ai', aiRoutes);
router.use('/changes', changeRoutes);

export default router;
