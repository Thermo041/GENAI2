import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { config } from './env.js';
import { logger } from '../utils/logger.js';
import { errors } from '../utils/errors.js';

const CodeWeaveOctokit = Octokit.plugin(retry, throttling);

function throttleOptions(label) {
  return {
    onRateLimit: (retryAfter, options, _octokit, retryCount) => {
      logger.warn({ label, method: options.method, url: options.url, retryAfter, retryCount }, 'GitHub rate limit hit');
      return retryCount < 1 && retryAfter <= 30;
    },
    onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
      logger.warn({ label, method: options.method, url: options.url, retryAfter }, 'GitHub secondary rate limit hit');
      return retryCount < 1 && retryAfter <= 30;
    },
  };
}

const baseOptions = (label) => ({
  userAgent: config.github.userAgent,
  request: { timeout: 30000 },
  throttle: throttleOptions(label),
  // The retry plugin compares numbers — strings here silently retried every 404.
  retry: { doNotRetry: [400, 401, 403, 404, 409, 422] },
});

let appClient = null;

/** Authenticates as the GitHub App itself (JWT). Used for installation lookups. */
export function getAppOctokit() {
  if (!config.github.appId || !config.github.privateKey) {
    throw errors.config('GitHub App is not configured. Set GITHUB_APP_ID and GITHUB_PRIVATE_KEY(_PATH).');
  }
  if (!appClient) {
    appClient = new CodeWeaveOctokit({
      ...baseOptions('app'),
      authStrategy: createAppAuth,
      auth: { appId: config.github.appId, privateKey: config.github.privateKey, clientId: config.github.clientId, clientSecret: config.github.clientSecret },
    });
  }
  return appClient;
}

/** Authenticates as an App installation (server-to-server, webhook handling). */
export function getInstallationOctokit(installationId) {
  if (!installationId) throw errors.badRequest('installationId is required.');
  return new CodeWeaveOctokit({
    ...baseOptions(`installation:${installationId}`),
    authStrategy: createAppAuth,
    auth: {
      appId: config.github.appId,
      privateKey: config.github.privateKey,
      clientId: config.github.clientId,
      clientSecret: config.github.clientSecret,
      installationId,
    },
  });
}

/**
 * Authenticates as the signed-in GitHub user (user-to-server token).
 * This is what enforces "the user can only do what GitHub lets them do".
 */
export function getUserOctokit(accessToken) {
  if (!accessToken) throw errors.githubAuthExpired();
  return new CodeWeaveOctokit({ ...baseOptions('user'), auth: accessToken });
}

/** Anonymous client — only for public metadata when nobody is signed in. */
export function getPublicOctokit() {
  return new CodeWeaveOctokit(baseOptions('public'));
}

export function githubConfigured() {
  return Boolean(config.github.appId && config.github.privateKey && config.github.clientId && config.github.clientSecret);
}

export async function githubAppHealth() {
  try {
    const { data } = await getAppOctokit().rest.apps.getAuthenticated();
    return { reachable: true, app: data.slug, name: data.name, permissions: data.permissions, events: data.events };
  } catch (err) {
    return { reachable: false, error: err.status ? `HTTP ${err.status}: ${err.message}` : err.message };
  }
}
