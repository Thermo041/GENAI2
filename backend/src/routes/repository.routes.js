import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { aiLimiter, indexingLimiter } from '../middleware/rateLimit.js';
import {
  analyzeRepository,
  analyzeSchema,
  getArchitectureGraph,
  getBranches,
  getCommits,
  getFile,
  getOverview,
  createOverviewNarrative,
  getRepositoryDetails,
  getRepositoryTree,
  getSymbols,
  listAnalyzedRepositories,
} from '../controllers/repository.controller.js';
import { getIndexStatus, listJobs, startIndexing, streamIndexEvents } from '../controllers/indexing.controller.js';

const router = Router();
const ownerRepo = z.object({ owner: z.string().min(1).max(39), repo: z.string().min(1).max(100) });

router.use(requireAuth);

router.post('/analyze', validate({ body: analyzeSchema }), analyzeRepository);
router.get('/', listAnalyzedRepositories);

router.get('/:owner/:repo', validate({ params: ownerRepo }), getRepositoryDetails);
router.get('/:owner/:repo/branches', validate({ params: ownerRepo }), getBranches);
router.get('/:owner/:repo/tree', validate({ params: ownerRepo }), getRepositoryTree);
router.get('/:owner/:repo/file', validate({ params: ownerRepo }), getFile);
router.get('/:owner/:repo/commits', validate({ params: ownerRepo }), getCommits);
router.get('/:owner/:repo/symbols', validate({ params: ownerRepo }), getSymbols);
router.get('/:owner/:repo/overview', validate({ params: ownerRepo }), getOverview);
router.post(
  '/:owner/:repo/overview',
  aiLimiter,
  validate({ params: ownerRepo, body: z.object({ refresh: z.boolean().optional() }) }),
  createOverviewNarrative,
);
router.get('/:owner/:repo/graph', validate({ params: ownerRepo }), getArchitectureGraph);

router.post(
  '/:owner/:repo/index',
  indexingLimiter,
  validate({ params: ownerRepo, body: z.object({ branch: z.string().max(240).optional(), force: z.boolean().optional() }) }),
  startIndexing,
);
router.get('/:owner/:repo/index-status', validate({ params: ownerRepo }), getIndexStatus);
router.get('/:owner/:repo/index-events', validate({ params: ownerRepo }), streamIndexEvents);
router.get('/:owner/:repo/jobs', validate({ params: ownerRepo }), listJobs);

export default router;
