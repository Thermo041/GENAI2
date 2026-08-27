import { getUserOctokit, getPublicOctokit, getInstallationOctokit } from '../../config/github.js';
import { User } from '../../models/User.js';
import { encryptSecret, decryptSecret } from '../../utils/crypto.js';
import { errors } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { refreshUserToken } from './oauth.js';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Returns a usable GitHub user token for `userId`, transparently refreshing it
 * with the stored refresh token when it is close to expiry. Throws
 * GITHUB_AUTH_EXPIRED when the user must reconnect — the frontend turns that
 * into a "Reconnect GitHub" prompt instead of retrying forever.
 */
export async function getUserAccessToken(userId) {
  const user = await User.findById(userId).select('+accessTokenEnc +refreshTokenEnc');
  if (!user) throw errors.unauthorized();

  const token = decryptSecret(user.accessTokenEnc);
  const expiresAt = user.accessTokenExpiresAt ? new Date(user.accessTokenExpiresAt).getTime() : null;
  const needsRefresh = !token || (expiresAt !== null && expiresAt - Date.now() < REFRESH_MARGIN_MS);

  if (!needsRefresh) return token;

  const refreshToken = decryptSecret(user.refreshTokenEnc);
  const refreshExpiry = user.refreshTokenExpiresAt ? new Date(user.refreshTokenExpiresAt).getTime() : null;
  if (!refreshToken || (refreshExpiry !== null && refreshExpiry < Date.now())) {
    if (token && (expiresAt === null || expiresAt > Date.now())) return token;
    throw errors.githubAuthExpired();
  }

  const refreshed = await refreshUserToken(refreshToken);
  user.accessTokenEnc = encryptSecret(refreshed.accessToken);
  user.accessTokenExpiresAt = refreshed.accessTokenExpiresAt;
  if (refreshed.refreshToken) {
    user.refreshTokenEnc = encryptSecret(refreshed.refreshToken);
    user.refreshTokenExpiresAt = refreshed.refreshTokenExpiresAt;
  }
  await user.save();
  logger.info({ userId: user._id.toString() }, 'Refreshed GitHub user token');
  return refreshed.accessToken;
}

/** Octokit acting as the signed-in user. */
export async function octokitForUser(userId) {
  const token = await getUserAccessToken(userId);
  return getUserOctokit(token);
}

/**
 * Octokit for a request: the user's client when signed in, otherwise an
 * anonymous client (public metadata only, 60 req/h).
 */
export async function octokitForRequest(req) {
  if (req.user?._id) return octokitForUser(req.user._id);
  return getPublicOctokit();
}

export function octokitForInstallation(installationId) {
  return getInstallationOctokit(installationId);
}
