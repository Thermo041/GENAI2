import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config/env.js';
import { fail } from '../utils/http.js';

// Per-user when signed in, otherwise per-IP (IPv6-safe via ipKeyGenerator).
const keyByUser = (req) => req.user?._id?.toString() || ipKeyGenerator(req.ip);

function limiter({ windowMs, max, code, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByUser,
    skip: () => config.isTest,
    handler: (_req, res) => fail(res, { code, message }, 429),
  });
}

/** Broad protection for the whole API surface. */
export const apiLimiter = limiter({
  windowMs: 60 * 1000,
  max: 240,
  code: 'RATE_LIMITED',
  message: 'Too many requests. Slow down for a moment.',
});

/** Groq-backed endpoints: the expensive ones. */
export const aiLimiter = limiter({
  windowMs: 60 * 1000,
  max: 15,
  code: 'AI_RATE_LIMITED',
  message: 'You are sending AI requests very quickly. Wait a few seconds and retry.',
});

/** Code generation and PR review cost the most tokens. */
export const heavyAiLimiter = limiter({
  windowMs: 5 * 60 * 1000,
  max: 12,
  code: 'AI_RATE_LIMITED',
  message: 'AI generation limit reached. Try again in a few minutes.',
});

/** Indexing is CPU + GitHub heavy. */
export const indexingLimiter = limiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  code: 'INDEXING_RATE_LIMITED',
  message: 'Too many indexing requests. Wait a few minutes before indexing again.',
});

/** Anything that writes to GitHub. */
export const writeLimiter = limiter({
  windowMs: 60 * 1000,
  max: 20,
  code: 'RATE_LIMITED',
  message: 'Too many GitHub write operations. Slow down.',
});

export const authLimiter = limiter({
  windowMs: 10 * 60 * 1000,
  max: 40,
  code: 'RATE_LIMITED',
  message: 'Too many authentication attempts. Try again shortly.',
});
