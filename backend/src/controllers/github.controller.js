import { z } from 'zod';
import { asyncHandler, ok } from '../utils/http.js';
import { errors } from '../utils/errors.js';
import { assertBranchName, isSafeBranchName } from '../utils/repoIdentity.js';
import { resolveRepository, assertWriteAccess } from '../services/repositoryAccess.js';
import { getAuthenticatedUser, getBranchHead } from '../services/github/repositories.js';
import { createBranch, ensureFork, syncForkWithUpstream, uniqueBranchName } from '../services/github/writes.js';
import { createPullRequest } from '../services/github/pulls.js';
import { octokitForUser } from '../services/github/client.js';

export const branchSchema = z.object({
  branch: z.string().min(1).max(240),
  fromBranch: z.string().max(240).optional(),
});

export const pullRequestSchema = z.object({
  title: z.string().min(3).max(250),
  body: z.string().max(20000).optional().default(''),
  head: z.string().min(1).max(300),
  base: z.string().min(1).max(240).optional(),
  draft: z.boolean().optional().default(false),
});

export const githubUser = asyncHandler(async (req, res) => {
  const octokit = await octokitForUser(req.user._id);
  const profile = await getAuthenticatedUser(octokit);
  return ok(res, {
    user: {
      login: profile.login,
      name: profile.name,
      avatarUrl: profile.avatar_url,
      publicRepos: profile.public_repos,
      privateRepos: profile.total_private_repos ?? null,
      url: profile.html_url,
    },
  });
});

/**
 * POST /api/github/:owner/:repo/fork — the fork half of the read-only workflow.
 * Idempotent: returns the existing fork when the user already has one.
 */
export const forkRepository = asyncHandler(async (req, res) => {
  const { octokit, meta } = await resolveRepository(req, req.params.owner, req.params.repo);
  if (meta.isPrivate) throw errors.forbidden('Private repositories cannot be forked through CodeWeave.');

  const fork = await ensureFork(octokit, { owner: meta.owner, repo: meta.name, viewerLogin: req.user.login });
  const sync = await syncForkWithUpstream(octokit, { owner: fork.owner, repo: fork.repo, branch: fork.defaultBranch });

  return ok(res, {
    fork: {
      owner: fork.owner,
      repo: fork.repo,
      fullName: fork.fullName,
      defaultBranch: fork.defaultBranch,
      url: fork.url,
      upstream: meta.fullName,
      created: fork.created,
    },
    sync,
    message: fork.created ? 'Your fork is ready.' : 'You already have a fork; CodeWeave will use it.',
  });
});

/** POST /api/github/:owner/:repo/branches — never allowed on the default branch. */
export const createRepositoryBranch = asyncHandler(async (req, res) => {
  const { octokit, meta } = await resolveRepository(req, req.params.owner, req.params.repo);
  assertWriteAccess(meta);

  const requested = assertBranchName(req.body.branch);
  if (requested === meta.defaultBranch) throw errors.badRequest('Choose a branch name other than the default branch.');

  const fromBranch = req.body.fromBranch && isSafeBranchName(req.body.fromBranch) ? req.body.fromBranch : meta.defaultBranch;
  const head = await getBranchHead(octokit, meta.owner, meta.name, fromBranch);
  const branch = await uniqueBranchName(octokit, { owner: meta.owner, repo: meta.name, branch: requested });
  const created = await createBranch(octokit, { owner: meta.owner, repo: meta.name, branch, fromSha: head.sha });

  return ok(res, { branch: created, from: { branch: fromBranch, sha: head.sha } }, 201);
});

/**
 * POST /api/github/:owner/:repo/pull-request — opens a PR from an existing
 * branch. `head` may be "forkOwner:branch" for the fork workflow.
 */
export const openPullRequest = asyncHandler(async (req, res) => {
  const { octokit, meta } = await resolveRepository(req, req.params.owner, req.params.repo);
  const head = req.body.head;
  const isCrossRepo = head.includes(':');

  if (!isCrossRepo) assertWriteAccess(meta);
  if (isCrossRepo && !head.startsWith(`${req.user.login}:`)) {
    throw errors.forbidden('You can only open pull requests from your own fork.');
  }

  const base = req.body.base && isSafeBranchName(req.body.base) ? req.body.base : meta.defaultBranch;
  const pullRequest = await createPullRequest(octokit, {
    owner: meta.owner,
    repo: meta.name,
    title: req.body.title,
    body: req.body.body,
    head,
    base,
    draft: req.body.draft,
  });

  return ok(res, { pullRequest }, 201);
});
