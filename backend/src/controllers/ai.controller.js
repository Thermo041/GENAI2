import { z } from 'zod';
import { asyncHandler, ok } from '../utils/http.js';
import { errors } from '../utils/errors.js';
import { assertSafeRepoPath } from '../utils/repoIdentity.js';
import { resolveRepository } from '../services/repositoryAccess.js';
import { answerQuestion, getConversation, listConversations } from '../services/ai/chat.js';
import { analyzeImpact } from '../services/ai/impact.js';
import { generateCodeChange } from '../services/codeModification/generateChange.js';
import { suggestBranchName, suggestCommitMessage } from '../services/codeModification/applyChange.js';
import { getBranchHead } from '../services/github/repositories.js';

const repoRef = { owner: z.string().min(1).max(39), repo: z.string().min(1).max(100) };

export const chatSchema = z.object({
  ...repoRef,
  question: z.string().min(3).max(2000),
  conversationId: z.string().length(24).optional(),
});

export const impactSchema = z.object({
  ...repoRef,
  symbol: z.string().min(1).max(200),
  filePath: z.string().max(400).optional(),
  explain: z.boolean().optional().default(true),
});

export const generateChangeSchema = z.object({
  ...repoRef,
  instruction: z.string().min(6).max(2000),
  files: z.array(z.string().max(400)).max(4).optional().default([]),
  branch: z.string().max(240).optional(),
});

/** Repositories must be indexed before any AI feature can be grounded. */
async function requireIndexed(req, owner, repo) {
  const resolved = await resolveRepository(req, owner, repo);
  const { doc } = resolved;
  if (!['indexed', 'partial'].includes(doc.indexingStatus)) {
    throw errors.notIndexed(
      doc.indexingStatus === 'indexing' || doc.indexingStatus === 'queued'
        ? 'This repository is still being indexed. Wait for indexing to finish.'
        : 'Index this repository before using AI features.',
    );
  }
  return resolved;
}

async function freshnessOf({ octokit, meta, doc }) {
  try {
    const head = await getBranchHead(octokit, meta.owner, meta.name, doc.indexedBranch || meta.defaultBranch);
    return {
      stale: Boolean(doc.lastIndexedCommitSha) && head.sha !== doc.lastIndexedCommitSha,
      headSha: head.sha,
      indexedSha: doc.lastIndexedCommitSha,
    };
  } catch {
    return { stale: false, headSha: '', indexedSha: doc.lastIndexedCommitSha };
  }
}

/** POST /api/ai/chat — real RAG over this repository only. */
export const chat = asyncHandler(async (req, res) => {
  const { owner, repo, question, conversationId } = req.body;
  const resolved = await requireIndexed(req, owner, repo);
  const result = await answerQuestion({
    repositoryDoc: resolved.doc,
    userId: req.user._id,
    question,
    conversationId,
  });
  return ok(res, { ...result, freshness: await freshnessOf(resolved) });
});

export const listRepositoryConversations = asyncHandler(async (req, res) => {
  const { doc } = await resolveRepository(req, req.query.owner, req.query.repo);
  return ok(res, { conversations: await listConversations({ userId: req.user._id, repositoryId: doc._id }) });
});

export const getRepositoryConversation = asyncHandler(async (req, res) => {
  const { doc } = await resolveRepository(req, req.query.owner, req.query.repo);
  const conversation = await getConversation({
    userId: req.user._id,
    repositoryId: doc._id,
    conversationId: req.query.conversationId,
  });
  return ok(res, { conversation });
});

/** POST /api/ai/impact-analysis — AST graph + vectors + explanation. */
export const impactAnalysis = asyncHandler(async (req, res) => {
  const { owner, repo, symbol, filePath, explain } = req.body;
  const resolved = await requireIndexed(req, owner, repo);
  const result = await analyzeImpact({
    repositoryDoc: resolved.doc,
    symbolName: symbol,
    filePath: filePath ? assertSafeRepoPath(filePath) : undefined,
    explain,
  });
  return ok(res, { impact: result, freshness: await freshnessOf(resolved) });
});

/**
 * POST /api/ai/generate-change — produces a reviewable patch. Allowed for
 * read-only repositories too: the write happens at accept time, through a fork.
 */
export const generateChange = asyncHandler(async (req, res) => {
  const { owner, repo, instruction, files, branch } = req.body;
  const resolved = await requireIndexed(req, owner, repo);
  const change = await generateCodeChange({
    repositoryDoc: resolved.doc,
    userId: req.user._id,
    octokit: resolved.octokit,
    meta: resolved.meta,
    instruction,
    targetFiles: files.map(assertSafeRepoPath),
    branch,
  });

  return ok(res, {
    change: serializeChange(change),
    suggestions: {
      branchName: suggestBranchName(instruction),
      commitMessage: suggestCommitMessage(change),
      requiresFork: !resolved.meta.permissions.canWrite,
    },
    access: resolved.meta.permissions,
  });
});

export function serializeChange(change) {
  return {
    id: change._id.toString(),
    instruction: change.instruction,
    summary: change.summary,
    reasoning: change.reasoning,
    warnings: change.warnings,
    impactedSymbols: change.impactedSymbols,
    status: change.status,
    statusMessage: change.statusMessage,
    baseOwner: change.baseOwner,
    baseRepo: change.baseRepo,
    baseBranch: change.baseBranch,
    baseCommitSha: change.baseCommitSha,
    headOwner: change.headOwner,
    headRepo: change.headRepo,
    headBranch: change.headBranch,
    viaFork: change.viaFork,
    commitSha: change.commitSha,
    commitMessage: change.commitMessage,
    pullRequestNumber: change.pullRequestNumber,
    pullRequestUrl: change.pullRequestUrl,
    totalAdditions: change.totalAdditions,
    totalDeletions: change.totalDeletions,
    contextFiles: change.contextFiles,
    model: change.model,
    createdAt: change.createdAt,
    files: change.files.map((file) => ({
      path: file.path,
      action: file.action,
      originalContent: file.originalContent,
      modifiedContent: file.modifiedContent,
      diff: file.diff,
      additions: file.additions,
      deletions: file.deletions,
      rationale: file.rationale,
    })),
  };
}
