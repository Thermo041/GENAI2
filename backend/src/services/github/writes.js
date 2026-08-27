import { errors } from '../../utils/errors.js';
import { assertBranchName, assertSafeRepoPath } from '../../utils/repoIdentity.js';
import { logger } from '../../utils/logger.js';
import { withGithub } from './errors.js';

/** Creates a ref. Fails loudly if the branch already exists. */
export async function createBranch(octokit, { owner, repo, branch, fromSha }) {
  assertBranchName(branch);
  if (!fromSha) throw errors.badRequest('A base commit SHA is required to create a branch.');
  const { data } = await withGithub({ resource: 'branch', branch }, () =>
    octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: fromSha }),
  );
  return { branch, sha: data.object.sha, ref: data.ref };
}

export async function branchExists(octokit, { owner, repo, branch }) {
  try {
    await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

/** Returns a branch name that does not exist yet (appends -2, -3, ...). */
export async function uniqueBranchName(octokit, { owner, repo, branch }) {
  let candidate = assertBranchName(branch);
  for (let attempt = 2; attempt <= 20; attempt += 1) {
    if (!(await branchExists(octokit, { owner, repo, branch: candidate }))) return candidate;
    candidate = `${branch}-${attempt}`;
  }
  throw errors.conflict('Could not find an unused branch name. Please choose one manually.');
}

/**
 * Commits several files in ONE commit using the git data API
 * (blobs -> tree -> commit -> ref). Never touches the default branch: the
 * caller must pass a CodeWeave branch, and we re-assert that here.
 */
export async function commitFiles(octokit, { owner, repo, branch, message, files, defaultBranch }) {
  assertBranchName(branch);
  if (defaultBranch && branch === defaultBranch) {
    throw errors.forbidden('CodeWeave never commits directly to the default branch.');
  }
  if (!Array.isArray(files) || files.length === 0) throw errors.badRequest('No files to commit.');
  if (!message || message.trim().length < 3) throw errors.badRequest('A commit message is required.');

  const ref = await withGithub({ resource: 'branch', branch }, () =>
    octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` }),
  );
  const parentSha = ref.data.object.sha;
  const parentCommit = await withGithub({ resource: 'branch', branch }, () =>
    octokit.rest.git.getCommit({ owner, repo, commit_sha: parentSha }),
  );

  const tree = [];
  for (const file of files) {
    const path = assertSafeRepoPath(file.path);
    const blob = await withGithub({ resource: 'file', path }, () =>
      octokit.rest.git.createBlob({ owner, repo, content: Buffer.from(file.content, 'utf8').toString('base64'), encoding: 'base64' }),
    );
    tree.push({ path, mode: file.mode || '100644', type: 'blob', sha: blob.data.sha });
  }

  const newTree = await withGithub({ resource: 'tree' }, () =>
    octokit.rest.git.createTree({ owner, repo, base_tree: parentCommit.data.tree.sha, tree }),
  );
  const commit = await withGithub({ resource: 'commit' }, () =>
    octokit.rest.git.createCommit({ owner, repo, message, tree: newTree.data.sha, parents: [parentSha] }),
  );
  await withGithub({ resource: 'branch', branch }, () =>
    octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.data.sha, force: false }),
  );

  logger.info({ owner, repo, branch, commit: commit.data.sha, files: files.length }, 'Committed AI change');
  return {
    sha: commit.data.sha,
    url: commit.data.html_url,
    branch,
    parentSha,
    files: files.map((f) => f.path),
  };
}

/**
 * Finds or creates the signed-in user's fork of owner/repo and waits until
 * GitHub has finished provisioning it. Returns fork identity + default branch.
 */
export async function ensureFork(octokit, { owner, repo, viewerLogin, waitMs = 30000 }) {
  const existing = await findExistingFork(octokit, { owner, repo, viewerLogin });
  if (existing) return { ...existing, created: false };

  await withGithub({ resource: 'repository' }, () => octokit.rest.repos.createFork({ owner, repo }));
  logger.info({ owner, repo, viewerLogin }, 'Requested fork creation');

  const deadline = Date.now() + waitMs;
  let delay = 1500;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.4, 5000);
    const fork = await findExistingFork(octokit, { owner, repo, viewerLogin });
    if (fork) return { ...fork, created: true };
  }
  throw errors.upstream('github', 'GitHub is still creating your fork. Wait a few seconds and try again.');
}

async function findExistingFork(octokit, { owner, repo, viewerLogin }) {
  try {
    const { data } = await octokit.rest.repos.get({ owner: viewerLogin, repo });
    const parentMatches = data.parent && data.parent.full_name.toLowerCase() === `${owner}/${repo}`.toLowerCase();
    const sourceMatches = data.source && data.source.full_name.toLowerCase() === `${owner}/${repo}`.toLowerCase();
    if (data.fork && (parentMatches || sourceMatches)) {
      return {
        owner: data.owner.login,
        repo: data.name,
        fullName: data.full_name,
        defaultBranch: data.default_branch,
        url: data.html_url,
        upstream: data.parent?.full_name || `${owner}/${repo}`,
      };
    }
    return null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/** Pulls upstream commits into the fork's default branch so patches apply cleanly. */
export async function syncForkWithUpstream(octokit, { owner, repo, branch }) {
  try {
    const { data } = await octokit.request('POST /repos/{owner}/{repo}/merge-upstream', { owner, repo, branch });
    return { merged: true, message: data.message, sha: data.base_branch };
  } catch (err) {
    logger.debug({ owner, repo, branch, status: err.status }, 'merge-upstream skipped');
    return { merged: false, message: 'Fork could not be fast-forwarded; using its current state.' };
  }
}
