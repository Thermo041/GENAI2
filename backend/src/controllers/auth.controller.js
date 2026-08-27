import { config } from '../config/env.js';
import { User } from '../models/User.js';
import { asyncHandler, ok } from '../utils/http.js';
import { errors } from '../utils/errors.js';
import { encryptSecret } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { buildAuthorizeUrl, exchangeCodeForToken, installationUrl } from '../services/github/oauth.js';
import { getUserOctokit } from '../config/github.js';
import { getAuthenticatedUser, listInstallations } from '../services/github/repositories.js';
import { getUserAccessToken } from '../services/github/client.js';

/** Step 1: send the browser to GitHub's user-authorization screen. */
export const startGithubAuth = (req, res) => {
  const { url, state } = buildAuthorizeUrl({});
  req.session.oauthState = state;
  req.session.returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.startsWith('/') ? req.query.returnTo : '/dashboard';
  return res.redirect(url);
};

/**
 * Step 2: GitHub redirects back with ?code (+ ?state when CodeWeave started the
 * flow). Two legitimate entry points land here:
 *
 *  1. Sign-in we initiated — `state` must match the value stored in the session.
 *  2. Installation with "Request user authorization" enabled — GitHub sends the
 *     user straight here with `code` + `installation_id` and no `state`, because
 *     GitHub initiated it. State is only enforced for case 1.
 */
export const githubCallback = asyncHandler(async (req, res) => {
  const { code, state, error: oauthError, error_description: description, installation_id: installationId } = req.query;
  const returnTo = req.session.returnTo || '/dashboard';

  if (oauthError) {
    logger.warn({ oauthError }, 'GitHub authorization denied');
    return res.redirect(`${config.clientUrl}/login?error=${encodeURIComponent(description || oauthError)}`);
  }

  const installInitiated = Boolean(installationId);
  if (!code) {
    return res.redirect(`${config.clientUrl}/login?error=${encodeURIComponent('GitHub did not return an authorization code.')}`);
  }
  if (!installInitiated && (!state || state !== req.session.oauthState)) {
    // Already signed in and the browser replayed the callback — send them on.
    if (req.session.userId) return res.redirect(`${config.clientUrl}${returnTo}`);
    return res.redirect(`${config.clientUrl}/login?error=${encodeURIComponent('Authorization state mismatch. Please try again.')}`);
  }
  delete req.session.oauthState;

  let tokens;
  try {
    tokens = await exchangeCodeForToken(String(code));
  } catch (err) {
    // Codes are single-use: a duplicated callback (browser prefetch, refresh)
    // must not log an already-authenticated user back out.
    if (req.session.userId) return res.redirect(`${config.clientUrl}${returnTo}`);
    logger.warn({ err: err.message }, 'GitHub code exchange failed');
    return res.redirect(`${config.clientUrl}/login?error=${encodeURIComponent(err.message)}`);
  }

  const octokit = getUserOctokit(tokens.accessToken);
  const profile = await getAuthenticatedUser(octokit);
  const installations = await listInstallations(octokit);
  const installationIds = [...new Set([...installations.map((i) => i.id), ...(installInitiated ? [Number(installationId)] : [])])].filter(Number.isFinite);

  const user = await User.findOneAndUpdate(
    { githubId: profile.id },
    {
      $set: {
        login: profile.login,
        name: profile.name || '',
        email: profile.email || '',
        avatarUrl: profile.avatar_url,
        profileUrl: profile.html_url,
        accessTokenEnc: encryptSecret(tokens.accessToken),
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenEnc: encryptSecret(tokens.refreshToken),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        tokenScopes: tokens.scopes,
        installationIds,
        lastLoginAt: new Date(),
      },
    },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  );

  await new Promise((resolve, reject) =>
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user._id.toString();
      return req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    }),
  );

  logger.info(
    { login: user.login, installations: installationIds.length, installInitiated },
    'GitHub user signed in',
  );
  return res.redirect(`${config.clientUrl}${returnTo}`);
});

export const me = asyncHandler(async (req, res) => {
  if (!req.user) return ok(res, { authenticated: false, csrfToken: req.csrfToken, installUrl: installationUrl() });

  const installations = await listInstallations(getUserOctokit(await getUserAccessToken(req.user._id)));
  if (installations.length !== req.user.installationIds.length) {
    req.user.installationIds = installations.map((i) => i.id);
    await req.user.save();
  }

  return ok(res, {
    authenticated: true,
    user: req.user.toPublicJSON(),
    installations,
    hasInstallation: installations.length > 0,
    installUrl: installationUrl(),
    csrfToken: req.csrfToken,
    githubApp: { slug: config.github.appSlug, clientId: config.github.clientId },
  });
});

export const logout = (req, res) => {
  const done = () => ok(res, { loggedOut: true });
  if (!req.session) return done();
  return req.session.destroy((err) => {
    if (err) logger.warn({ err: err.message }, 'Session destroy failed');
    res.clearCookie(config.session.name);
    return done();
  });
};

export const updatePreferences = asyncHandler(async (req, res) => {
  if (!req.user) throw errors.unauthorized();
  const theme = req.body?.theme;
  if (theme && ['dark', 'light'].includes(theme)) {
    req.user.preferences.theme = theme;
    await req.user.save();
  }
  return ok(res, { preferences: { theme: req.user.preferences.theme } });
});
