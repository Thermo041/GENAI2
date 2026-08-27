import { config } from '../../config/env.js';
import { errors } from '../../utils/errors.js';
import { randomToken } from '../../utils/crypto.js';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

/**
 * GitHub App *user authorization* (OAuth) flow — no Personal Access Tokens
 * anywhere. Returns the URL to redirect the browser to, plus the state value
 * the caller must store in the session for CSRF protection.
 */
export function buildAuthorizeUrl({ state = randomToken(24), redirectUri } = {}) {
  const params = new URLSearchParams({
    client_id: config.github.clientId,
    redirect_uri: redirectUri || config.github.callbackUrl,
    state,
  });
  return { url: `${AUTHORIZE_URL}?${params.toString()}`, state };
}

export function installationUrl() {
  const slug = config.github.appSlug;
  return slug ? `https://github.com/apps/${slug}/installations/new` : 'https://github.com/settings/installations';
}

async function postToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': config.github.userAgent },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw errors.upstream('github', `GitHub token endpoint returned HTTP ${res.status}.`);
  const data = await res.json();

  if (data.error) {
    if (data.error === 'bad_verification_code') throw errors.badRequest('That GitHub authorization code is invalid or expired. Please try connecting again.');
    if (data.error === 'bad_refresh_token' || data.error === 'unauthorized') throw errors.githubAuthExpired();
    throw errors.upstream('github', `GitHub authorization failed (${data.error}).`);
  }
  if (!data.access_token) throw errors.upstream('github', 'GitHub did not return an access token.');

  const now = Date.now();
  return {
    accessToken: data.access_token,
    // GitHub App user tokens expire in 8h when "expiring user tokens" is on.
    accessTokenExpiresAt: data.expires_in ? new Date(now + Number(data.expires_in) * 1000) : null,
    refreshToken: data.refresh_token || '',
    refreshTokenExpiresAt: data.refresh_token_expires_in
      ? new Date(now + Number(data.refresh_token_expires_in) * 1000)
      : null,
    scopes: data.scope ? String(data.scope).split(',').filter(Boolean) : [],
  };
}

export function exchangeCodeForToken(code, redirectUri) {
  if (!code) throw errors.badRequest('Missing GitHub authorization code.');
  return postToken({
    client_id: config.github.clientId,
    client_secret: config.github.clientSecret,
    code,
    redirect_uri: redirectUri || config.github.callbackUrl,
  });
}

export function refreshUserToken(refreshToken) {
  if (!refreshToken) throw errors.githubAuthExpired();
  return postToken({
    client_id: config.github.clientId,
    client_secret: config.github.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}
