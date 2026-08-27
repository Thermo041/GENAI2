/**
 * Every failure the API surfaces goes through AppError so the response shape
 * stays `{ success:false, error:{ code, message } }` and stack traces never
 * reach the browser.
 */
export class AppError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

export const errors = {
  badRequest: (message = 'Invalid request.', details) => new AppError('BAD_REQUEST', message, 400, details),
  validation: (message = 'Validation failed.', details) => new AppError('VALIDATION_ERROR', message, 422, details),
  unauthorized: (message = 'You need to sign in with GitHub.') => new AppError('UNAUTHORIZED', message, 401),
  githubAuthExpired: (message = 'Your GitHub connection needs to be refreshed.') =>
    new AppError('GITHUB_AUTH_EXPIRED', message, 401),
  forbidden: (message = 'You are not allowed to perform this action.') => new AppError('FORBIDDEN', message, 403),
  noWriteAccess: (message = 'You do not have write access to this repository.') =>
    new AppError('NO_WRITE_ACCESS', message, 403),
  notFound: (message = 'Not found.') => new AppError('NOT_FOUND', message, 404),
  repoNotFound: (message = 'Repository not found on GitHub.') => new AppError('REPO_NOT_FOUND', message, 404),
  privateNoAccess: (message = "You don't have access to this private repository.") =>
    new AppError('PRIVATE_NO_ACCESS', message, 403),
  conflict: (message = 'Conflicting state.') => new AppError('CONFLICT', message, 409),
  rateLimited: (message = 'Too many requests. Please slow down.') => new AppError('RATE_LIMITED', message, 429),
  githubRateLimit: (message = 'GitHub API rate limit reached. Please try again later.') =>
    new AppError('GITHUB_RATE_LIMIT', message, 429),
  notIndexed: (message = 'This repository has not been indexed yet.') => new AppError('NOT_INDEXED', message, 409),
  staleIndex: (message = 'This repository has changed since it was last indexed.') =>
    new AppError('STALE_INDEX', message, 409),
  patchFailed: (message = 'CodeWeave could not safely apply this change.') =>
    new AppError('PATCH_FAILED', message, 422),
  aiOutput: (message = 'The AI returned an unusable response. Please retry.') =>
    new AppError('AI_OUTPUT_INVALID', message, 502),
  upstream: (service, message) => new AppError(`${service.toUpperCase()}_ERROR`, message, 502),
  config: (message) => new AppError('CONFIGURATION_ERROR', message, 500),
  internal: (message = 'Something went wrong on our side.') => new AppError('INTERNAL_ERROR', message, 500),
};

export function isAppError(err) {
  return err instanceof AppError;
}
