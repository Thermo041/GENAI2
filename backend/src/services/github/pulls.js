import { errors } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { withGithub } from './errors.js';
import { readWithFallback } from './repositories.js';

function normalizePull(pr) {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body || '',
    state: pr.merged_at ? 'merged' : pr.state,
    isDraft: Boolean(pr.draft),
    author: pr.user?.login || '',
    authorAvatar: pr.user?.avatar_url || '',
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    mergedAt: pr.merged_at,
    closedAt: pr.closed_at,
    url: pr.html_url,
    additions: pr.additions ?? null,
    deletions: pr.deletions ?? null,
    changedFiles: pr.changed_files ?? null,
    commits: pr.commits ?? null,
    mergeable: pr.mergeable ?? null,
    head: { ref: pr.head?.ref, sha: pr.head?.sha, repo: pr.head?.repo?.full_name || '' },
    base: { ref: pr.base?.ref, sha: pr.base?.sha, repo: pr.base?.repo?.full_name || '' },
    labels: (pr.labels || []).map((l) => ({ name: l.name, color: l.color })),
  };
}

export async function listPullRequests(octokit, owner, repo, { state = 'open', perPage = 30, page = 1 } = {}) {
  const { data } = await readWithFallback(octokit, { resource: 'pull' }, (client) =>
    client.rest.pulls.list({ owner, repo, state, per_page: perPage, page, sort: 'updated', direction: 'desc' }),
  );
  return data.map(normalizePull);
}

export async function getPullRequest(octokit, owner, repo, number) {
  const { data } = await readWithFallback(octokit, { resource: 'pull' }, (client) =>
    client.rest.pulls.get({ owner, repo, pull_number: number }),
  );
  return normalizePull(data);
}

/** Changed files with their unified patches (GitHub caps patches at ~3000 lines). */
export async function getPullRequestFiles(octokit, owner, repo, number, { perPage = 100, maxPages = 3 } = {}) {
  const files = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await readWithFallback(octokit, { resource: 'pull' }, (client) =>
      client.rest.pulls.listFiles({ owner, repo, pull_number: number, per_page: perPage, page }),
    );
    files.push(
      ...data.map((f) => ({
        path: f.filename,
        previousPath: f.previous_filename || '',
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch || '',
        sha: f.sha,
        blobUrl: f.blob_url,
      })),
    );
    if (data.length < perPage) break;
  }
  return files;
}

export async function getPullRequestCommits(octokit, owner, repo, number) {
  const { data } = await readWithFallback(octokit, { resource: 'pull' }, (client) =>
    client.rest.pulls.listCommits({ owner, repo, pull_number: number, per_page: 100 }),
  );
  return data.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author: c.commit.author?.name || c.author?.login || '',
    date: c.commit.author?.date || null,
  }));
}

/**
 * Creates a PR. For the fork flow `head` must be "forkOwner:branch" and
 * owner/repo must be the UPSTREAM repository.
 */
export async function createPullRequest(octokit, { owner, repo, title, body, head, base, draft = false }) {
  if (!title?.trim()) throw errors.badRequest('A pull request title is required.');
  if (!head || !base) throw errors.badRequest('Both head and base branches are required.');
  const { data } = await withGithub({ resource: 'pull' }, () =>
    octokit.rest.pulls.create({ owner, repo, title, body, head, base, draft, maintainer_can_modify: true }),
  );
  logger.info({ owner, repo, number: data.number, head, base }, 'Pull request created');
  return normalizePull(data);
}

/**
 * Publishes the AI review to GitHub. Always uses event=COMMENT: GitHub forbids
 * APPROVE/REQUEST_CHANGES on your own pull request, and CodeWeave should never
 * silently approve code on a user's behalf.
 */
export async function postReviewComment(octokit, { owner, repo, number, body }) {
  try {
    const { data } = await octokit.rest.pulls.createReview({ owner, repo, pull_number: number, body, event: 'COMMENT' });
    return { url: data.html_url, id: data.id, kind: 'review' };
  } catch (err) {
    if (err.status === 422 || err.status === 403) {
      const { data } = await withGithub({ resource: 'pull' }, () =>
        octokit.rest.issues.createComment({ owner, repo, issue_number: number, body }),
      );
      return { url: data.html_url, id: data.id, kind: 'comment' };
    }
    throw err;
  }
}

export async function listPullRequestsForCommit(octokit, owner, repo, sha) {
  try {
    const { data } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({ owner, repo, commit_sha: sha });
    return data.map(normalizePull);
  } catch {
    return [];
  }
}
