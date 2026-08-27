import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { errors } from '../../utils/errors.js';

/**
 * Client-side tokens-per-minute governor for Groq.
 *
 * The free tier allows 8k tokens/minute across all requests, so two AI features
 * used back to back would otherwise 429. CodeWeave paces itself instead: each
 * call reserves its estimated tokens in a 60-second sliding window and waits for
 * room (bounded), then the reservation is corrected with the real usage the API
 * reports.
 */
const WINDOW_MS = 60_000;
const SAFETY = 0.95;

let entries = [];

function prune(now) {
  entries = entries.filter((entry) => now - entry.at < WINDOW_MS);
}

function used(now) {
  prune(now);
  return entries.reduce((sum, entry) => sum + entry.tokens, 0);
}

export function currentUsage() {
  return { usedTokens: used(Date.now()), limit: config.groq.tpmLimit, window: '60s' };
}

/**
 * Waits until `tokens` fit in the current window.
 * @returns {Promise<{ id: symbol }>} handle used to settle the reservation.
 */
export async function reserveTokens(tokens, { maxWaitMs = 45_000, label = 'groq' } = {}) {
  const limit = Math.max(1000, Math.round(config.groq.tpmLimit * SAFETY));
  const need = Math.max(1, Math.min(tokens, limit));
  const deadline = Date.now() + maxWaitMs;

  for (;;) {
    const now = Date.now();
    if (used(now) + need <= limit) break;

    const oldest = entries[0];
    const waitMs = oldest ? Math.max(250, WINDOW_MS - (now - oldest.at) + 100) : 500;
    if (now + waitMs > deadline) {
      throw errors.rateLimited(
        `CodeWeave is pacing AI requests to stay inside the Groq limit of ${config.groq.tpmLimit} tokens/minute. Try again in a few seconds.`,
      );
    }
    logger.debug({ label, waitMs, usedTokens: used(now), need, limit }, 'Waiting for Groq token budget');
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, deadline - now)));
  }

  const id = Symbol('groq-reservation');
  entries.push({ id, at: Date.now(), tokens: need });
  return { id };
}

/** Replaces the estimate with the real token count once the call returns. */
export function settleTokens(handle, actualTokens) {
  if (!handle) return;
  const entry = entries.find((item) => item.id === handle.id);
  if (!entry) return;
  if (Number.isFinite(actualTokens) && actualTokens > 0) entry.tokens = actualTokens;
}

export function releaseTokens(handle) {
  if (!handle) return;
  entries = entries.filter((entry) => entry.id !== handle.id);
}

/** Test helper — resets the window. */
export function resetRateLimiter() {
  entries = [];
}
