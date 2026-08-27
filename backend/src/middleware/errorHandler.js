import { config } from '../config/env.js';
import { isAppError } from '../utils/errors.js';
import { fail } from '../utils/http.js';
import { logger, scrubSecrets } from '../utils/logger.js';

export function notFoundHandler(req, res) {
  return fail(res, { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` }, 404);
}

/**
 * Central error handler. Users see a code + a sentence; stack traces and
 * upstream details stay in the server log, scrubbed of anything token-shaped.
 */
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;

  if (isAppError(err)) {
    const level = err.status >= 500 ? 'error' : 'warn';
    logger[level](
      { code: err.code, status: err.status, path: req.originalUrl, requestId: req.id, userId: req.user?._id?.toString() },
      scrubSecrets(err.message),
    );
    return fail(res, { code: err.code, message: err.message, details: err.details }, err.status);
  }

  if (err?.type === 'entity.too.large') {
    return fail(res, { code: 'PAYLOAD_TOO_LARGE', message: 'That request body is too large.' }, 413);
  }
  if (/not allowed by CORS/i.test(err?.message || '')) {
    logger.warn({ origin: req.get('origin'), path: req.originalUrl }, 'Rejected cross-origin request');
    return fail(res, { code: 'CORS_NOT_ALLOWED', message: 'This origin is not allowed to call the CodeWeave API.' }, 403);
  }
  if (err?.name === 'ValidationError') {
    return fail(res, { code: 'VALIDATION_ERROR', message: 'Some fields are invalid.', details: Object.keys(err.errors || {}) }, 422);
  }
  if (err?.name === 'CastError') {
    return fail(res, { code: 'BAD_REQUEST', message: 'That identifier is not valid.' }, 400);
  }
  if (err?.code === 11000) {
    return fail(res, { code: 'CONFLICT', message: 'That record already exists.' }, 409);
  }
  if (err?.name === 'MongoNetworkError' || err?.name === 'MongooseServerSelectionError') {
    logger.error({ err: err.message }, 'MongoDB unavailable');
    return fail(res, { code: 'DATABASE_UNAVAILABLE', message: 'The database is unreachable right now. Please retry.' }, 503);
  }

  logger.error(
    { err: scrubSecrets(err?.stack || err?.message || String(err)), path: req.originalUrl, requestId: req.id },
    'Unhandled error',
  );
  return fail(
    res,
    {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side.',
      details: config.isProd ? undefined : scrubSecrets(String(err?.message || err)),
    },
    500,
  );
}
