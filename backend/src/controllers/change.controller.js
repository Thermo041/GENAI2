import { z } from 'zod';
import { asyncHandler, ok } from '../utils/http.js';
import { errors } from '../utils/errors.js';
import { CodeChange } from '../models/CodeChange.js';
import { Repository } from '../models/Repository.js';
import { resolveRepository } from '../services/repositoryAccess.js';
import { applyChange, buildPullRequestBody, suggestBranchName, suggestCommitMessage } from '../services/codeModification/applyChange.js';
import { serializeChange } from './ai.controller.js';

export const acceptSchema = z.object({
  branchName: z.string().max(240).optional(),
  commitMessage: z.string().max(500).optional(),
  prTitle: z.string().max(250).optional(),
  prBody: z.string().max(20000).optional(),
  createPullRequest: z.boolean().optional().default(true),
});

async function loadOwnChange(req) {
  const change = await CodeChange.findOne({ _id: req.params.id, userId: req.user._id });
  if (!change) throw errors.notFound('That proposed change was not found.');
  return change;
}

export const listChanges = asyncHandler(async (req, res) => {
  const filter = { userId: req.user._id };
  if (req.query.owner && req.query.repo) {
    const { doc } = await resolveRepository(req, req.query.owner, req.query.repo);
    filter.repositoryId = doc._id;
  }
  const changes = await CodeChange.find(filter).sort({ createdAt: -1 }).limit(30);
  const repositoryIds = [...new Set(changes.map((c) => c.repositoryId.toString()))];
  const repos = await Repository.find({ _id: { $in: repositoryIds } }).select('fullName').lean();
  const nameById = new Map(repos.map((r) => [r._id.toString(), r.fullName]));

  return ok(res, {
    changes: changes.map((change) => ({
      id: change._id.toString(),
      repository: nameById.get(change.repositoryId.toString()) || `${change.baseOwner}/${change.baseRepo}`,
      instruction: change.instruction,
      summary: change.summary,
      status: change.status,
      statusMessage: change.statusMessage,
      files: change.files.map((f) => f.path),
      totalAdditions: change.totalAdditions,
      totalDeletions: change.totalDeletions,
      viaFork: change.viaFork,
      headBranch: change.headBranch,
      pullRequestNumber: change.pullRequestNumber,
      pullRequestUrl: change.pullRequestUrl,
      createdAt: change.createdAt,
    })),
  });
});

export const getChange = asyncHandler(async (req, res) => {
  const change = await loadOwnChange(req);
  return ok(res, {
    change: serializeChange(change),
    suggestions: {
      branchName: change.headBranch || suggestBranchName(change.instruction),
      commitMessage: change.commitMessage || suggestCommitMessage(change),
      prBody: buildPullRequestBody(change, { viaFork: change.viaFork, upstream: `${change.baseOwner}/${change.baseRepo}` }),
    },
  });
});

/**
 * POST /api/changes/:id/accept — the only path that writes to GitHub.
 * Permissions are re-checked here against GitHub, not trusted from the client.
 */
export const acceptChange = asyncHandler(async (req, res) => {
  const change = await loadOwnChange(req);
  const { meta, octokit } = await resolveRepository(req, change.baseOwner, change.baseRepo);

  const result = await applyChange({
    change,
    octokit,
    meta,
    viewerLogin: req.user.login,
    branchName: req.body.branchName,
    commitMessage: req.body.commitMessage,
    prTitle: req.body.prTitle,
    prBody: req.body.prBody,
    createPr: req.body.createPullRequest !== false,
  });

  return ok(res, {
    change: serializeChange(result.change),
    pullRequest: result.pullRequest,
    head: { owner: result.head.owner, repo: result.head.repo, branch: result.branch },
    commit: { sha: result.commit.sha, url: result.commit.url },
    viaFork: result.viaFork,
    message: result.pullRequest
      ? `Pull request #${result.pullRequest.number} opened.`
      : `Committed to ${result.head.owner}/${result.head.repo}@${result.branch}.`,
  });
});

export const rejectChange = asyncHandler(async (req, res) => {
  const change = await loadOwnChange(req);
  if (['committed', 'pr_open'].includes(change.status)) {
    throw errors.conflict('This change has already been pushed to GitHub and cannot be rejected here.');
  }
  change.status = 'rejected';
  change.statusMessage = 'Rejected by the user.';
  await change.save();
  return ok(res, { change: { id: change._id.toString(), status: change.status } });
});
