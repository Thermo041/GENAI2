import { logger } from '../../utils/logger.js';
import { errors } from '../../utils/errors.js';
import { PullRequestReview } from '../../models/PullRequestReview.js';
import { CodeEdge } from '../../models/CodeEdge.js';
import { CodeFile } from '../../models/CodeFile.js';
import { getPullRequest, getPullRequestFiles, getPullRequestCommits, postReviewComment } from '../github/pulls.js';
import { getFileContent } from '../github/contents.js';
import { retrieveContext } from '../ai/retrieval.js';
import { invokeStructured } from '../ai/groqService.js';
import { prReviewSchema } from '../ai/schemas.js';
import { PR_REVIEW_SYSTEM_PROMPT, renderChunk, wrapRepositoryContext } from '../ai/prompts.js';
import { tokenBudget } from '../ai/budget.js';
import { isTestPath } from '../../utils/fileFilter.js';

const MAX_REVIEW_FILES = 12;

/**
 * AI pull request review that reads more than the diff: PR metadata + patches +
 * the current version of changed files + AST callers/importers + semantically
 * related code + existing test files.
 */
export async function reviewPullRequest({ repositoryDoc, octokit, meta, number, userId, trigger = 'manual', postToGithub = false, force = false }) {
  const pr = await getPullRequest(octokit, meta.owner, meta.name, number);
  const existing = await PullRequestReview.findOne({ owner: meta.owner, repo: meta.name, number, headSha: pr.head.sha });
  if (existing && !force) return { review: existing, cached: true, pullRequest: pr };

  const [files, commits] = await Promise.all([
    getPullRequestFiles(octokit, meta.owner, meta.name, number),
    getPullRequestCommits(octokit, meta.owner, meta.name, number),
  ]);

  const codeFiles = files.filter((f) => f.patch && f.status !== 'removed');
  if (codeFiles.length === 0) {
    throw errors.badRequest('This pull request has no reviewable text diff (binary or empty changes only).');
  }

  const reviewFiles = codeFiles
    .sort((a, b) => b.changes - a.changes)
    .slice(0, MAX_REVIEW_FILES);

  // The diff is the priority; surrounding file content and semantic context get
  // what is left of the input budget.
  const budget = tokenBudget({ outputShare: 0.45 });
  const diffBudget = Math.round(budget.inputChars * 0.5);
  const contextBudget = Math.round(budget.inputChars * 0.28);

  const diffBlock = buildDiffBlock(reviewFiles, diffBudget);
  const contextFiles = await loadFileContext(octokit, meta, reviewFiles, pr.head, contextBudget);
  const graphBlock = await buildGraphBlock(repositoryDoc._id, reviewFiles.map((f) => f.path));
  const testBlock = await buildTestBlock(repositoryDoc._id, reviewFiles.map((f) => f.path));

  const semantic = repositoryDoc.indexingStatus === 'indexed' || repositoryDoc.indexingStatus === 'partial'
    ? await retrieveContext({
        repositoryId: repositoryDoc._id,
        question: `${pr.title}\n${(pr.body || '').slice(0, 500)}\n${reviewFiles.map((f) => f.path).join(' ')}`,
        limit: 8,
        maxChars: Math.round(budget.inputChars * 0.16),
        includeGraph: false,
      })
    : { chunks: [] };

  const context = wrapRepositoryContext([
    `PULL REQUEST #${pr.number}: ${pr.title}`,
    `AUTHOR: ${pr.author} | BASE: ${pr.base.repo}:${pr.base.ref} | HEAD: ${pr.head.repo}:${pr.head.ref}`,
    pr.body ? `DESCRIPTION:\n${pr.body.slice(0, 2000)}` : null,
    `COMMITS:\n${commits.slice(0, 15).map((c) => `- ${c.sha.slice(0, 7)} ${c.message.split('\n')[0]}`).join('\n')}`,
    `CHANGED FILES (${files.length}, showing ${reviewFiles.length}):\n${files
      .map((f) => `- ${f.path} [${f.status}] +${f.additions}/-${f.deletions}`)
      .join('\n')}`,
    `DIFF:\n${diffBlock}`,
    contextFiles.length ? `CURRENT CONTENT OF CHANGED FILES (post-merge state on the head branch):\n${contextFiles.join('\n\n')}` : null,
    graphBlock,
    testBlock,
    semantic.chunks.length ? `RELATED REPOSITORY CODE (vector search):\n${semantic.chunks.slice(0, 4).map(renderChunk).join('\n\n')}` : null,
  ]);

  const prompt = [
    context,
    'Review this pull request.',
    'Return JSON: { "summary": string, "verdict": "approve"|"comment"|"request_changes", "riskLevel": "HIGH"|"MEDIUM"|"LOW", "findings": [{ "severity", "confidence", "category", "filePath", "line", "title", "issue", "recommendation" }], "testGaps": string[], "breakingChanges": string[] }',
    'Only report findings you can justify from the material above. Report at most the 8 most important findings. An empty findings array is a valid answer for a clean PR.',
  ].join('\n\n');

  const { data, usage, model } = await invokeStructured({
    system: PR_REVIEW_SYSTEM_PROMPT,
    user: prompt,
    schema: prReviewSchema,
    temperature: 0.15,
    maxTokens: budget.outputTokens,
    maxWaitMs: 90_000,
  });

  const validPaths = new Set(files.map((f) => f.path));
  const findings = data.findings.filter((f) => !f.filePath || validPaths.has(f.filePath) || f.confidence === 'INSUFFICIENT_CONTEXT');

  const review = await PullRequestReview.findOneAndUpdate(
    { owner: meta.owner, repo: meta.name, number, headSha: pr.head.sha },
    {
      $set: {
        repositoryId: repositoryDoc._id,
        userId: userId || null,
        title: pr.title,
        author: pr.author,
        state: pr.state,
        verdict: data.verdict,
        summary: data.summary,
        riskLevel: data.riskLevel,
        findings,
        testGaps: data.testGaps,
        breakingChanges: data.breakingChanges,
        filesReviewed: reviewFiles.length,
        additions: files.reduce((sum, f) => sum + f.additions, 0),
        deletions: files.reduce((sum, f) => sum + f.deletions, 0),
        contextFiles: reviewFiles.map((f) => f.path),
        model,
        trigger,
      },
    },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  );

  if (postToGithub) {
    try {
      const posted = await postReviewComment(octokit, {
        owner: meta.owner,
        repo: meta.name,
        number,
        body: formatReviewComment(review),
      });
      review.postedToGithub = true;
      review.githubCommentUrl = posted.url;
      await review.save();
    } catch (err) {
      logger.warn({ number, err: err.message }, 'Could not post AI review to GitHub');
    }
  }

  logger.info(
    { repo: meta.fullName, pr: number, findings: findings.length, risk: data.riskLevel, tokens: usage?.totalTokens },
    'AI PR review complete',
  );

  return { review, cached: false, pullRequest: pr, files };
}

function buildDiffBlock(reviewFiles, maxChars) {
  let used = 0;
  const parts = [];
  const perFileCap = Math.max(1200, Math.round(maxChars / Math.max(1, Math.min(4, reviewFiles.length))));
  for (const file of reviewFiles) {
    const patch = file.patch.length > perFileCap ? `${file.patch.slice(0, perFileCap)}\n... [patch truncated]` : file.patch;
    if (used + patch.length > maxChars) break;
    used += patch.length;
    parts.push(`--- ${file.path} [${file.status}] +${file.additions}/-${file.deletions}\n${patch}`);
  }
  return parts.join('\n\n');
}

async function loadFileContext(octokit, meta, reviewFiles, headRef, maxChars) {
  const [ownerLogin, repoName] = (headRef.repo || `${meta.owner}/${meta.name}`).split('/');
  const out = [];
  let budget = maxChars;
  for (const file of reviewFiles.slice(0, 4)) {
    if (isTestPath(file.path)) continue;
    try {
      const content = await getFileContent(octokit, ownerLogin, repoName, file.path, headRef.sha);
      if (content.binary || content.content.length > budget) continue;
      budget -= content.content.length;
      out.push(`FILE ${file.path} (${content.lines} lines):\n\`\`\`\n${content.content}\n\`\`\``);
    } catch {
      // Head repo may be a fork we cannot read; the diff alone still works.
    }
  }
  return out;
}

async function buildGraphBlock(repositoryId, paths) {
  if (!paths.length) return null;
  const edges = await CodeEdge.find({
    repositoryId,
    type: { $in: ['imports', 'calls'] },
    toFile: { $in: paths },
  })
    .select('fromFile fromSymbol toFile toName type line')
    .limit(50)
    .lean();
  if (!edges.length) return 'DEPENDENTS (AST graph): none indexed for these files.';
  return `DEPENDENTS OF THE CHANGED FILES (AST graph — these could break):\n${edges
    .slice(0, 30)
    .map((e) => `- ${e.fromFile}:${e.line} ${e.fromSymbol || '<module>'} ${e.type === 'imports' ? 'imports' : 'calls'} ${e.toName} (${e.toFile})`)
    .join('\n')}`;
}

async function buildTestBlock(repositoryId, paths) {
  const tests = await CodeFile.find({ repositoryId, isTest: true }).select('filePath').limit(60).lean();
  if (!tests.length) return 'TEST FILES IN REPOSITORY: none indexed.';
  const related = tests.filter((t) =>
    paths.some((p) => {
      const base = p.split('/').pop().replace(/\.[a-z]+$/i, '');
      return t.filePath.includes(base);
    }),
  );
  return [
    `TEST FILES IN REPOSITORY: ${tests.length} (e.g. ${tests.slice(0, 5).map((t) => t.filePath).join(', ')})`,
    related.length
      ? `TESTS THAT LOOK RELATED TO THE CHANGED FILES:\n${related.map((t) => `- ${t.filePath}`).join('\n')}`
      : 'No test file name matches the changed files.',
  ].join('\n');
}

/** Markdown body posted to the PR when the user asks CodeWeave to publish it. */
export function formatReviewComment(review) {
  const bySeverity = { HIGH: [], MEDIUM: [], LOW: [] };
  for (const finding of review.findings) bySeverity[finding.severity]?.push(finding);

  const sections = Object.entries(bySeverity)
    .filter(([, items]) => items.length)
    .map(([severity, items]) =>
      [
        `### ${severity}`,
        ...items.map(
          (f) =>
            `**${f.title}** — \`${f.filePath}${f.line ? `:${f.line}` : ''}\` _(${f.confidence})_\n\n${f.issue}\n\n> ${f.recommendation}`,
        ),
      ].join('\n\n'),
    );

  return [
    '## CodeWeave AI review',
    `**Risk:** ${review.riskLevel} · **Findings:** ${review.findings.length} · **Files reviewed:** ${review.filesReviewed}`,
    '',
    review.summary,
    '',
    ...sections,
    review.testGaps?.length ? `### Test gaps\n${review.testGaps.map((t) => `- ${t}`).join('\n')}` : '',
    review.breakingChanges?.length ? `### Possible breaking changes\n${review.breakingChanges.map((b) => `- ${b}`).join('\n')}` : '',
    '',
    '---',
    '_Generated by CodeWeave. Findings are AI-produced suggestions, not approvals._',
  ]
    .filter((s) => s !== '')
    .join('\n');
}
