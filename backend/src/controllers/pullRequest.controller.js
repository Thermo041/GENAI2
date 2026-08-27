import { z } from 'zod';
import { asyncHandler, ok } from '../utils/http.js';
import { errors } from '../utils/errors.js';
import { PullRequestReview } from '../models/PullRequestReview.js';
import { resolveRepository } from '../services/repositoryAccess.js';
import { getPullRequest, getPullRequestCommits, getPullRequestFiles, listPullRequests } from '../services/github/pulls.js';
import { reviewPullRequest, formatReviewComment } from '../services/pullRequests/review.js';

export const reviewSchema = z.object({
  postToGithub: z.boolean().optional().default(false),
  force: z.boolean().optional().default(false),
});

const numberParam = (value) => {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number <= 0) throw errors.badRequest('Invalid pull request number.');
  return number;
};

export const listRepositoryPulls = asyncHandler(async (req, res) => {
  const { octokit, meta, doc } = await resolveRepository(req, req.params.owner, req.params.repo);
  const state = ['open', 'closed', 'all'].includes(req.query.state) ? req.query.state : 'open';
  const pulls = await listPullRequests(octokit, meta.owner, meta.name, { state, perPage: 30 });

  const reviews = await PullRequestReview.find({
    repositoryId: doc._id,
    number: { $in: pulls.map((p) => p.number) },
  })
    .select('number headSha riskLevel findings verdict createdAt')
    .lean();
  const byNumber = new Map(reviews.map((r) => [r.number, r]));

  return ok(res, {
    pulls: pulls.map((pr) => ({
      ...pr,
      aiReview: byNumber.get(pr.number)
        ? {
            riskLevel: byNumber.get(pr.number).riskLevel,
            findings: byNumber.get(pr.number).findings.length,
            verdict: byNumber.get(pr.number).verdict,
            stale: byNumber.get(pr.number).headSha !== pr.head.sha,
            createdAt: byNumber.get(pr.number).createdAt,
          }
        : null,
    })),
    state,
    access: { canReview: true, canComment: meta.permissions.canWrite || meta.permissions.triage },
  });
});

export const getRepositoryPull = asyncHandler(async (req, res) => {
  const number = numberParam(req.params.number);
  const { octokit, meta, doc } = await resolveRepository(req, req.params.owner, req.params.repo);

  const [pullRequest, files, commits] = await Promise.all([
    getPullRequest(octokit, meta.owner, meta.name, number),
    getPullRequestFiles(octokit, meta.owner, meta.name, number),
    getPullRequestCommits(octokit, meta.owner, meta.name, number),
  ]);

  const review = await PullRequestReview.findOne({ repositoryId: doc._id, number }).sort({ createdAt: -1 }).lean();

  return ok(res, {
    pullRequest,
    files,
    commits,
    review: review
      ? { ...review, id: review._id.toString(), stale: review.headSha !== pullRequest.head.sha, comment: formatReviewComment(review) }
      : null,
    indexStatus: doc.indexingStatus,
  });
});

/** POST /api/github/:owner/:repo/pulls/:number/review — real AI review. */
export const reviewRepositoryPull = asyncHandler(async (req, res) => {
  const number = numberParam(req.params.number);
  const { octokit, meta, doc } = await resolveRepository(req, req.params.owner, req.params.repo);

  if (req.body.postToGithub && !(meta.permissions.canWrite || meta.permissions.triage || meta.permissions.pull)) {
    throw errors.forbidden('You do not have permission to comment on this repository.');
  }

  const { review, cached, pullRequest } = await reviewPullRequest({
    repositoryDoc: doc,
    octokit,
    meta,
    number,
    userId: req.user._id,
    trigger: 'manual',
    postToGithub: req.body.postToGithub === true,
    force: req.body.force === true,
  });

  return ok(res, {
    review: { ...review.toObject(), id: review._id.toString(), comment: formatReviewComment(review) },
    cached,
    pullRequest,
  });
});

export const getStoredReview = asyncHandler(async (req, res) => {
  const number = numberParam(req.params.number);
  const { doc } = await resolveRepository(req, req.params.owner, req.params.repo);
  const review = await PullRequestReview.findOne({ repositoryId: doc._id, number }).sort({ createdAt: -1 }).lean();
  if (!review) throw errors.notFound('No AI review has been generated for this pull request yet.');
  return ok(res, { review: { ...review, id: review._id.toString(), comment: formatReviewComment(review) } });
});
