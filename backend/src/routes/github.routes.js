import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { heavyAiLimiter, writeLimiter } from '../middleware/rateLimit.js';
import {
  branchSchema,
  createRepositoryBranch,
  forkRepository,
  getForkStatus,
  githubUser,
  openPullRequest,
  pullRequestSchema,
} from '../controllers/github.controller.js';
import { listGithubRepositories } from '../controllers/repository.controller.js';
import {
  getRepositoryPull,
  getStoredReview,
  listRepositoryPulls,
  reviewRepositoryPull,
  reviewSchema,
} from '../controllers/pullRequest.controller.js';

const router = Router();

const ownerRepo = z.object({ owner: z.string().min(1).max(39), repo: z.string().min(1).max(100) });
const ownerRepoNumber = ownerRepo.extend({ number: z.string().regex(/^\d+$/) });

router.use(requireAuth);

router.get('/user', githubUser);
router.get('/repositories', listGithubRepositories);

// Write operations
router.get('/:owner/:repo/fork', validate({ params: ownerRepo }), getForkStatus);
router.post('/:owner/:repo/fork', writeLimiter, validate({ params: ownerRepo }), forkRepository);
router.post('/:owner/:repo/branches', writeLimiter, validate({ params: ownerRepo, body: branchSchema }), createRepositoryBranch);
router.post('/:owner/:repo/pull-request', writeLimiter, validate({ params: ownerRepo, body: pullRequestSchema }), openPullRequest);

// Pull requests + AI review
router.get('/:owner/:repo/pulls', validate({ params: ownerRepo }), listRepositoryPulls);
router.get('/:owner/:repo/pulls/:number', validate({ params: ownerRepoNumber }), getRepositoryPull);
router.get('/:owner/:repo/pulls/:number/review', validate({ params: ownerRepoNumber }), getStoredReview);
router.post(
  '/:owner/:repo/pulls/:number/review',
  heavyAiLimiter,
  validate({ params: ownerRepoNumber, body: reviewSchema }),
  reviewRepositoryPull,
);

export default router;
