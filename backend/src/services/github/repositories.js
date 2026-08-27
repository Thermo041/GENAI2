import { getPublicOctokit } from '../../config/github.js';
import { logger } from '../../utils/logger.js';
import { errors } from '../../utils/errors.js';
import { withGithub } from './errors.js';

/**
 * Normalises GitHub's permission object into the shape CodeWeave reasons about.
 * `owner === user` is deliberately NOT used to infer write access — only what
 * GitHub reports, because org policies and outside-collaborator roles vary.
 */
export function normalizePermissions(repoData) {
  const p = repoData?.permissions || {};
  const permissions = {
    admin: Boolean(p.admin),
    maintain: Boolean(p.maintain),
    push: Boolean(p.push),
    triage: Boolean(p.triage),
    pull: Boolean(p.pull ?? true),
  };
  const role = permissions.admin
    ? 'admin'
    : permissions.maintain
      ? 'maintain'
      : permissions.push
        ? 'write'
        : permissions.triage
          ? 'triage'
          : 'read';
  return {
    ...permissions,
    role,
    canWrite: permissions.push || permissions.maintain || permissions.admin,
    canRead: true,
  };
}

export function normalizeRepository(data, permissions) {
  return {
    githubRepositoryId: data.id,
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    url: data.html_url,
    description: data.description || '',
    visibility: data.private ? 'private' : data.visibility || 'public',
    isPrivate: Boolean(data.private),
    isFork: Boolean(data.fork),
    isArchived: Boolean(data.archived),
    isEmpty: (data.size ?? 0) === 0,
    parentFullName: data.parent?.full_name || '',
    parentDefaultBranch: data.parent?.default_branch || '',
    sourceFullName: data.source?.full_name || '',
    defaultBranch: data.default_branch || 'main',
    primaryLanguage: data.language || '',
    stars: data.stargazers_count ?? 0,
    forks: data.forks_count ?? 0,
    openIssues: data.open_issues_count ?? 0,
    sizeKb: data.size ?? 0,
    topics: data.topics || [],
    pushedAt: data.pushed_at ? new Date(data.pushed_at) : null,
    ownerAvatar: data.owner.avatar_url,
    ownerType: data.owner.type,
    permissions,
  };
}

/**
 * Reads with the caller's token, falling back to the anonymous public client
 * when the App installation cannot see a *public* repository. Keeps public
 * repository analysis working without asking users to install the App on
 * repositories they don't own.
 *
 * The anonymous budget is only 60 requests/hour, so once it is exhausted the
 * fallback is short-circuited for a minute instead of retrying every call.
 */
let publicBlockedUntil = 0;

export async function readWithFallback(octokit, context, call) {
  try {
    return await withGithub(context, () => call(octokit));
  } catch (err) {
    if (!['REPO_NOT_FOUND', 'NOT_FOUND', 'FORBIDDEN', 'NO_WRITE_ACCESS'].includes(err.code)) throw err;
    if (Date.now() < publicBlockedUntil) throw err;
    try {
      return await withGithub(context, () => call(getPublicOctokit()));
    } catch (publicErr) {
      if (publicErr.code === 'GITHUB_RATE_LIMIT') {
        publicBlockedUntil = Date.now() + 60_000;
        logger.debug('Anonymous GitHub budget exhausted; skipping public fallback for 60s');
      }
      throw err;
    }
  }
}

export async function getAuthenticatedUser(octokit) {
  const { data } = await withGithub({ resource: 'user' }, () => octokit.rest.users.getAuthenticated());
  return data;
}

/** Repositories the user can see through the App installation, newest activity first. */
export async function listUserRepositories(octokit, { perPage = 100, maxPages = 3 } = {}) {
  const repos = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await withGithub({ resource: 'repositories' }, () =>
      octokit.request('GET /user/repos', { per_page: perPage, page, sort: 'pushed', affiliation: 'owner,collaborator,organization_member' }),
    );
    repos.push(...data);
    if (data.length < perPage) break;
  }
  return repos.map((repo) => normalizeRepository(repo, normalizePermissions(repo)));
}

export async function listInstallations(octokit) {
  try {
    const { data } = await octokit.request('GET /user/installations', { per_page: 100 });
    return (data.installations || []).map((i) => ({
      id: i.id,
      account: i.account?.login || '',
      accountType: i.account?.type || '',
      repositorySelection: i.repository_selection,
    }));
  } catch {
    return [];
  }
}

export async function getRepository(octokit, owner, repo, { authenticated = true } = {}) {
  try {
    const { data } = await readWithFallback(octokit, { resource: 'repository' }, (client) =>
      client.rest.repos.get({ owner, repo }),
    );
    return normalizeRepository(data, normalizePermissions(data));
  } catch (err) {
    if (err.code === 'REPO_NOT_FOUND' || err.code === 'NOT_FOUND') {
      throw authenticated
        ? errors.privateNoAccess(
            "You don't have access to this repository. If it is private, make sure your GitHub account can see it and that CodeWeave is installed on it.",
          )
        : errors.repoNotFound('Repository not found. Sign in with GitHub to analyse private repositories.');
    }
    throw err;
  }
}

export async function getLanguages(octokit, owner, repo) {
  try {
    const { data } = await readWithFallback(octokit, { resource: 'repository' }, (client) =>
      client.rest.repos.listLanguages({ owner, repo }),
    );
    return data || {};
  } catch {
    return {};
  }
}

export async function listBranches(octokit, owner, repo, { perPage = 100 } = {}) {
  const { data } = await readWithFallback(octokit, { resource: 'branch' }, (client) =>
    client.rest.repos.listBranches({ owner, repo, per_page: perPage }),
  );
  return data.map((b) => ({ name: b.name, sha: b.commit.sha, protected: Boolean(b.protected) }));
}

export async function getBranchHead(octokit, owner, repo, branch) {
  const { data } = await readWithFallback(octokit, { resource: 'branch', branch }, (client) =>
    client.rest.repos.getBranch({ owner, repo, branch }),
  );
  return {
    name: data.name,
    sha: data.commit.sha,
    message: data.commit.commit?.message || '',
    author: data.commit.commit?.author?.name || '',
    committedAt: data.commit.commit?.author?.date || null,
    protected: Boolean(data.protected),
  };
}
