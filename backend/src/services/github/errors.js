import { AppError, errors } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/**
 * Translates Octokit/GitHub failures into CodeWeave AppErrors. Keeps GitHub's
 * own wording out of user-facing messages except where it is genuinely helpful,
 * and never leaks headers or tokens.
 */
export function mapGithubError(err, context = {}) {
  if (err instanceof AppError) return err;

  const status = err?.status ?? err?.response?.status;
  const message = String(err?.message || 'GitHub request failed');
  const headers = err?.response?.headers || {};
  const remaining = headers['x-ratelimit-remaining'];

  if (status === 401) {
    return errors.githubAuthExpired();
  }
  if (status === 403 && (remaining === '0' || /rate limit|secondary rate/i.test(message))) {
    const reset = Number(headers['x-ratelimit-reset']) * 1000;
    const wait = reset && Number.isFinite(reset) ? Math.max(0, Math.round((reset - Date.now()) / 1000)) : null;
    return errors.githubRateLimit(
      wait ? `GitHub API rate limit reached. Try again in about ${Math.ceil(wait / 60)} minute(s).` : undefined,
    );
  }
  if (status === 403) {
    if (/archived/i.test(message)) return errors.forbidden('This repository is archived on GitHub and cannot be modified.');
    if (/must be a member|resource not accessible/i.test(message)) {
      return errors.forbidden('GitHub refused this action for your account. Check your repository permissions or the CodeWeave app installation.');
    }
    return errors.forbidden('GitHub refused this action for your account.');
  }
  if (status === 404) {
    if (context.resource === 'repository') return errors.repoNotFound();
    if (context.resource === 'branch') return errors.notFound(`Branch "${context.branch}" was not found.`);
    if (context.resource === 'file') return errors.notFound(`File "${context.path}" was not found on that branch.`);
    if (context.resource === 'pull') return errors.notFound('That pull request was not found.');
    return errors.notFound('GitHub could not find that resource.');
  }
  if (status === 409) {
    return errors.conflict(/empty/i.test(message) ? 'That repository is empty, so there is nothing to analyse yet.' : 'GitHub reported a conflict. The branch may have moved — retry.');
  }
  if (status === 422) {
    if (/already exists/i.test(message)) return errors.conflict('That branch already exists on GitHub.');
    if (/No commits between/i.test(message)) return errors.conflict('There are no changes between these branches, so no pull request can be created.');
    if (/A pull request already exists/i.test(message)) return errors.conflict('A pull request already exists for that branch.');
    return errors.badRequest(`GitHub rejected the request: ${message}`);
  }
  if (status === 451) return errors.forbidden('This repository is unavailable for legal reasons.');
  if (status >= 500) return errors.upstream('github', 'GitHub is having problems right now. Please try again.');

  logger.debug({ status, err: message, context }, 'Unmapped GitHub error');
  return errors.upstream('github', 'GitHub request failed. Please try again.');
}

/** Wrap any Octokit call so failures always surface as AppErrors. */
export async function withGithub(context, fn) {
  try {
    return await fn();
  } catch (err) {
    throw mapGithubError(err, context);
  }
}
