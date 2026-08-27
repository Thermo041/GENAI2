import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import { logger } from '../utils/logger.js';

/**
 * Request-scoped logging: every line carries requestId, method, path, status and
 * duration. Secrets are redacted by the logger configuration itself.
 */
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = req.headers['x-request-id'] || randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
  customErrorMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  autoLogging: {
    ignore: (req) => req.url === '/api/health' || req.url === '/health',
  },
});
