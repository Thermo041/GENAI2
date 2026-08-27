import { errors } from '../../utils/errors.js';
import { assertSafeRepoPath } from '../../utils/repoIdentity.js';
import { looksBinary } from '../../utils/fileFilter.js';
import { withGithub } from './errors.js';
import { readWithFallback } from './repositories.js';

/**
 * Full recursive tree for a commit. GitHub caps this response; `truncated`
 * is surfaced so indexing can tell the user the repository was too large.
 */
export async function getTree(octokit, owner, repo, commitSha) {
  const { data } = await readWithFallback(octokit, { resource: 'tree' }, (client) =>
    client.rest.git.getTree({ owner, repo, tree_sha: commitSha, recursive: '1' }),
  );
  return {
    sha: data.sha,
    truncated: Boolean(data.truncated),
    entries: (data.tree || [])
      .filter((e) => e.type === 'blob')
      .map((e) => ({ path: e.path, sha: e.sha, size: e.size ?? 0, mode: e.mode })),
    directories: (data.tree || []).filter((e) => e.type === 'tree').map((e) => e.path),
  };
}

/**
 * File content by path. Uses the contents API (handles ref resolution) and
 * falls back to the blob API for files above the 1 MB contents-API limit.
 */
export async function getFileContent(octokit, owner, repo, filePath, ref) {
  const path = assertSafeRepoPath(filePath);
  const { data } = await readWithFallback(octokit, { resource: 'file', path }, (client) =>
    client.rest.repos.getContent({ owner, repo, path, ref }),
  );

  if (Array.isArray(data)) throw errors.badRequest(`"${path}" is a directory, not a file.`);
  if (data.type !== 'file') throw errors.badRequest(`"${path}" is a ${data.type}, not a file.`);

  let content = '';
  if (data.content && data.encoding === 'base64') {
    content = Buffer.from(data.content, 'base64').toString('utf8');
  } else if (data.sha) {
    content = await getBlobContent(octokit, owner, repo, data.sha);
  }

  const binary = looksBinary(content);
  return {
    path,
    sha: data.sha,
    size: data.size ?? content.length,
    content: binary ? '' : content,
    binary,
    htmlUrl: data.html_url || '',
    lines: binary ? 0 : content.split('\n').length,
  };
}

export async function getBlobContent(octokit, owner, repo, sha) {
  const { data } = await readWithFallback(octokit, { resource: 'file' }, (client) =>
    client.rest.git.getBlob({ owner, repo, file_sha: sha }),
  );
  if (data.encoding === 'base64') return Buffer.from(data.content, 'base64').toString('utf8');
  return data.content || '';
}

/** Cheap existence/identity probe used before applying a patch. */
export async function getFileSha(octokit, owner, repo, filePath, ref) {
  try {
    const file = await getFileContent(octokit, owner, repo, filePath, ref);
    return file.sha;
  } catch (err) {
    if (err.code === 'NOT_FOUND') return null;
    throw err;
  }
}

export async function listCommits(octokit, owner, repo, { sha, perPage = 20, path } = {}) {
  const { data } = await readWithFallback(octokit, { resource: 'repository' }, (client) =>
    client.rest.repos.listCommits({ owner, repo, sha, per_page: perPage, ...(path ? { path } : {}) }),
  );
  return data.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author: c.commit.author?.name || c.author?.login || '',
    authorLogin: c.author?.login || '',
    avatarUrl: c.author?.avatar_url || '',
    date: c.commit.author?.date || null,
    url: c.html_url,
  }));
}

/** Compares two commits — used by webhook incremental sync. */
export async function compareCommits(octokit, owner, repo, base, head) {
  const { data } = await withGithub({ resource: 'repository' }, () =>
    octokit.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${base}...${head}` }),
  );
  return {
    status: data.status,
    aheadBy: data.ahead_by,
    behindBy: data.behind_by,
    files: (data.files || []).map((f) => ({
      path: f.filename,
      previousPath: f.previous_filename || '',
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
  };
}
