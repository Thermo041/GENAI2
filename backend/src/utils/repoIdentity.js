import { errors } from './errors.js';

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH_BAD = /(^\.|\.\.|[~^:?*[\\\s]|\/\/|\/$|\.lock$|@\{)/;

/**
 * Accepts any of:
 *   https://github.com/owner/repo(.git)(/tree/branch)(/anything)
 *   git@github.com:owner/repo.git
 *   owner/repo
 * and returns { owner, repo, branch|null }. Rejects everything else — this is
 * the only place user-supplied repository identity is parsed.
 */
export function parseRepoInput(input) {
  if (typeof input !== 'string' || !input.trim()) throw errors.badRequest('Enter a GitHub repository URL or owner/repo.');
  let value = input.trim();
  let branch = null;

  value = value.replace(/^git\+/, '');
  if (value.startsWith('git@github.com:')) value = `https://github.com/${value.slice('git@github.com:'.length)}`;
  if (/^github\.com\//i.test(value)) value = `https://${value}`;

  if (/^https?:\/\//i.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw errors.badRequest('That does not look like a valid GitHub URL.');
    }
    const host = url.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') {
      throw errors.badRequest('Only github.com repositories are supported.');
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2) throw errors.badRequest('URL must include an owner and a repository.');
    const [owner, rawRepo, kind, ...rest] = segments;
    if ((kind === 'tree' || kind === 'blob') && rest.length) branch = rest[0];
    return finalize(owner, rawRepo, branch);
  }

  const segments = value.split('/').filter(Boolean);
  if (segments.length !== 2) throw errors.badRequest('Use the format owner/repo or a full GitHub URL.');
  return finalize(segments[0], segments[1], null);
}

function finalize(owner, rawRepo, branch) {
  const repo = String(rawRepo || '').replace(/\.git$/i, '');
  if (!OWNER_RE.test(owner)) throw errors.badRequest(`"${owner}" is not a valid GitHub owner name.`);
  if (!REPO_RE.test(repo)) throw errors.badRequest(`"${repo}" is not a valid repository name.`);
  return { owner, repo, fullName: `${owner}/${repo}`, branch: branch && isSafeBranchName(branch) ? branch : null };
}

export function isSafeBranchName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 240 && !BRANCH_BAD.test(name);
}

export function assertBranchName(name) {
  if (!isSafeBranchName(name)) throw errors.badRequest(`"${name}" is not a valid git branch name.`);
  return name;
}

/**
 * Repository-relative path validation. Rejects absolute paths, traversal,
 * NUL bytes, backslashes and .git internals. Returns the normalised path.
 */
export function assertSafeRepoPath(input) {
  if (typeof input !== 'string' || !input.trim()) throw errors.badRequest('A file path is required.');
  const value = input.trim().replace(/^\.\//, '');
  if (value.includes('\0')) throw errors.badRequest('Invalid file path.');
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw errors.badRequest('File paths must be repository-relative.');
  if (value.includes('\\')) throw errors.badRequest('Use forward slashes in file paths.');
  const parts = value.split('/');
  if (parts.some((part) => part === '..' || part === '.' || part === '')) {
    throw errors.badRequest('File path contains an invalid segment.');
  }
  if (parts[0] === '.git') throw errors.badRequest('Git internals cannot be accessed.');
  if (value.length > 400) throw errors.badRequest('File path is too long.');
  return value;
}

export function assertOwnerRepo(owner, repo) {
  return finalize(owner, repo, null);
}
