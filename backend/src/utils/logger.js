import pino from 'pino';
import { config } from '../config/env.js';

/**
 * Structured logger. Every field that could carry a credential is redacted at
 * the logger level so an accidental `logger.info({ err })` can never leak a
 * GitHub token, Groq key, Qdrant key or the App private key.
 */
export const logger = pino({
  level: config.logLevel,
  base: { service: 'codeweave-api', env: config.env },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-hub-signature-256"]',
      'res.headers["set-cookie"]',
      'token',
      'accessToken',
      'refreshToken',
      'installationToken',
      'password',
      'secret',
      'apiKey',
      'privateKey',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.apiKey',
      '*.privateKey',
      '*.client_secret',
      '*.authorization',
    ],
    censor: '[redacted]',
  },
  transport: config.isProd
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' } },
});

const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gsk_[A-Za-z0-9]{20,}/g,
  /-----BEGIN[^-]+PRIVATE KEY-----[\s\S]+?-----END[^-]+PRIVATE KEY-----/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

/** Last line of defence: strip token-shaped substrings out of any string. */
export function scrubSecrets(input) {
  if (typeof input !== 'string') return input;
  let out = input;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]');
  return out;
}

export function childLogger(bindings) {
  return logger.child(bindings);
}
