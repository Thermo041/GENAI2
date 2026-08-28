import axios from 'axios';

export const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

const CSRF_COOKIE = 'codeweave.csrf';
const CSRF_HEADER = 'X-CSRF-Token';

/** Errors the UI can branch on: `error.code` mirrors the backend error codes. */
export class ApiError extends Error {
  constructor({ code, message, status, details }) {
    super(message);
    this.name = 'ApiError';
    this.code = code || 'UNKNOWN_ERROR';
    this.status = status ?? 0;
    this.details = details;
  }

  get isAuthExpired() {
    return this.code === 'GITHUB_AUTH_EXPIRED' || this.code === 'UNAUTHORIZED';
  }

  get isNotIndexed() {
    return this.code === 'NOT_INDEXED';
  }

  get isRateLimited() {
    return ['RATE_LIMITED', 'AI_RATE_LIMITED', 'GITHUB_RATE_LIMIT', 'INDEXING_RATE_LIMITED'].includes(this.code);
  }
}

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&')}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

export const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true,
  timeout: 180000,
  headers: { 'Content-Type': 'application/json' },
});

let cachedCsrfToken = '';

api.interceptors.request.use((config) => {
  const token = cachedCsrfToken || readCookie(CSRF_COOKIE);
  if (token && !['get', 'head', 'options'].includes((config.method || 'get').toLowerCase())) {
    config.headers[CSRF_HEADER] = token;
  }
  return config;
});

/** Fires when GitHub authorization is gone, so the shell can prompt a reconnect. */
const authListeners = new Set();
export function onAuthExpired(listener) {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

api.interceptors.response.use(
  (response) => {
    const headerToken = response.headers?.[CSRF_HEADER.toLowerCase()];
    if (headerToken) cachedCsrfToken = headerToken;
    return response.data && 'data' in response.data ? response.data.data : response.data;
  },
  (error) => {
    const headerToken = error.response?.headers?.[CSRF_HEADER.toLowerCase()];
    if (headerToken) cachedCsrfToken = headerToken;

    if (axios.isCancel(error)) return Promise.reject(new ApiError({ code: 'CANCELLED', message: 'Request cancelled.' }));

    const status = error.response?.status;
    const payload = error.response?.data?.error;

    if (!error.response) {
      return Promise.reject(
        new ApiError({
          code: error.code === 'ECONNABORTED' ? 'TIMEOUT' : 'NETWORK_ERROR',
          message:
            error.code === 'ECONNABORTED'
              ? 'The request took too long. Try again.'
              : 'Cannot reach the CodeWeave API. Is the backend running?',
          status: 0,
        }),
      );
    }

    const apiError = new ApiError({
      code: payload?.code,
      message: payload?.message || error.message || 'Request failed.',
      status,
      details: payload?.details,
    });

    if (apiError.isAuthExpired && !error.config?.url?.includes('/auth/me')) {
      for (const listener of authListeners) listener(apiError);
    }
    return Promise.reject(apiError);
  },
);

export function githubLoginUrl(returnTo = '/dashboard') {
  return `${API_BASE_URL}/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`;
}

export function indexEventsUrl(owner, repo) {
  return `${API_BASE_URL}/api/repositories/${owner}/${repo}/index-events`;
}
