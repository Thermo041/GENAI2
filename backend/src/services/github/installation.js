import { getAppOctokit } from '../../config/github.js';
import { logger } from '../../utils/logger.js';

/**
 * Can this *user's* token act on this repository beyond public reads?
 *
 * A GitHub App user token is scoped to the installations the user themselves can
 * reach. Forking `someoneelse/repo` therefore fails even when the App happens to
 * be installed on that other account — which is exactly the 403 users used to
 * hit at accept time. These helpers let CodeWeave say so up front instead.
 *
 * Answers are cached for five minutes; the checks run on every repository view.
 */
const TTL_MS = 5 * 60 * 1000;
const repoCache = new Map();
const userCache = new Map();

/** Accounts (and repository selection) the signed-in user's token can act for. */
export async function viewerInstallationAccounts(octokit, userId) {
  const key = String(userId || 'anonymous');
  const hit = userCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.accounts;

  let accounts = [];
  try {
    const { data } = await octokit.request('GET /user/installations', { per_page: 100 });
    accounts = (data.installations || []).map((i) => ({
      login: (i.account?.login || '').toLowerCase(),
      selection: i.repository_selection,
      id: i.id,
    }));
  } catch (err) {
    logger.debug({ userId: key, err: err.message }, 'Could not list viewer installations');
  }
  userCache.set(key, { accounts, at: Date.now() });
  return accounts;
}

/**
 * True when the user's own installation covers `owner` — the condition GitHub
 * enforces for forking and for any write through a user-to-server token.
 */
export function viewerCoversOwner(accounts, owner) {
  return accounts.some((account) => account.login === String(owner || '').toLowerCase());
}

/** Is the CodeWeave App installed on the account that owns this repository? */
export async function appInstalledOnRepo(owner, repo) {
  const key = `${owner}/${repo}`.toLowerCase();
  const hit = repoCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.installed;

  let installed = false;
  try {
    await getAppOctokit().rest.apps.getRepoInstallation({ owner, repo });
    installed = true;
  } catch (err) {
    if (err.status !== 404) logger.debug({ owner, repo, status: err.status }, 'Installation lookup failed');
    installed = false;
  }
  repoCache.set(key, { installed, at: Date.now() });
  return installed;
}

export function clearInstallationCache() {
  repoCache.clear();
  userCache.clear();
}
