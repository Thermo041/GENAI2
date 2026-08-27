import { config } from '../config/env.js';
import { errors } from '../utils/errors.js';
import { randomToken, safeEqual } from '../utils/crypto.js';

const COOKIE = 'codeweave.csrf';
const HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit cookie CSRF protection. The token cookie is readable by the
 * SPA (so it can echo it in a header); the session cookie itself stays
 * httpOnly. A cross-site form post cannot set the header, so it fails.
 */
export function csrfToken(req, res, next) {
  let token = req.cookies?.[COOKIE];
  if (!token) {
    token = randomToken(24);
    res.cookie(COOKIE, token, {
      httpOnly: false,
      secure: config.isProd,
      sameSite: config.isProd ? 'none' : 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });
  }
  req.csrfToken = token;
  return next();
}

export function requireCsrf(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  // Webhooks are authenticated by HMAC signature, not by session cookies.
  if (req.path.startsWith('/api/github/webhook')) return next();

  const cookieToken = req.cookies?.[COOKIE];
  const headerToken = req.get(HEADER);
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return next(errors.forbidden('CSRF check failed. Refresh the page and try again.'));
  }
  return next();
}

export const CSRF_COOKIE_NAME = COOKIE;
export const CSRF_HEADER_NAME = HEADER;
