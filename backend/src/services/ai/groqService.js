import { getChatModel } from '../../config/groq.js';
import { config } from '../../config/env.js';
import { errors } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { estimateTokens } from './budget.js';
import { releaseTokens, reserveTokens, settleTokens } from './rateLimiter.js';

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('')
      .trim();
  }
  return '';
}

function usageOf(message) {
  const usage = message?.usage_metadata || {};
  return {
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
  };
}

/** Plain text completion. */
export async function invokeText({ system, user, tier = 'main', temperature = 0.15, maxTokens, maxWaitMs }) {
  const model = getChatModel({ tier, temperature, maxTokens });
  const started = Date.now();
  const reservation = await reserveTokens(estimateTokens(system) + estimateTokens(user) + (maxTokens ?? config.groq.maxTokens), {
    label: 'text',
    ...(maxWaitMs ? { maxWaitMs } : {}),
  });
  try {
    const message = await model.invoke([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    const text = contentToText(message.content);
    if (!text) throw errors.aiOutput('The AI returned an empty response.');
    const usage = usageOf(message);
    settleTokens(reservation, usage.totalTokens);
    logger.debug({ tier, ms: Date.now() - started, ...usage }, 'Groq text completion');
    return { text, usage, model: tier === 'fast' ? config.groq.fastModel : config.groq.model };
  } catch (err) {
    releaseTokens(reservation);
    throw normalizeGroqError(err);
  }
}

/** Extracts the outermost JSON object from a model response. */
export function extractJson(raw) {
  const text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    try {
      return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

/** Marks a rejection the model can fix if we ask again with the reason. */
class OutputRejected extends Error {}

/**
 * Structured completion validated against a Zod schema. A malformed response is
 * retried once with the validation error appended; an upstream failure (auth,
 * rate limit, timeout) is surfaced immediately instead of being retried blindly.
 * AI output is never trusted unvalidated, especially for patches.
 */
export async function invokeStructured({ system, user, schema, tier = 'main', temperature = 0.1, maxTokens, attempts = 2, maxWaitMs }) {
  let lastError = null;
  let prompt = user;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const model = getChatModel({ tier, temperature, maxTokens, json: true });
    const reservation = await reserveTokens(estimateTokens(system) + estimateTokens(prompt) + (maxTokens ?? config.groq.maxTokens), {
      label: 'structured',
      ...(maxWaitMs ? { maxWaitMs } : {}),
    });
    try {
      const message = await model.invoke([
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ]);
      const text = contentToText(message.content);
      const parsed = extractJson(text);
      if (!parsed) throw new OutputRejected('Response was not valid JSON.');
      const result = schema.safeParse(parsed);
      if (!result.success) {
        throw new OutputRejected(
          `Schema validation failed: ${result.error.issues
            .slice(0, 6)
            .map((i) => `${i.path.join('.') || 'root'} ${i.message}`)
            .join('; ')}`,
        );
      }
      const usage = usageOf(message);
      settleTokens(reservation, usage.totalTokens);
      return { data: result.data, usage, model: tier === 'fast' ? config.groq.fastModel : config.groq.model };
    } catch (err) {
      releaseTokens(reservation);
      if (!(err instanceof OutputRejected)) throw normalizeGroqError(err);
      lastError = err;
      logger.warn({ attempt, err: err.message }, 'Structured AI output rejected');
      prompt = `${user}\n\nYour previous response was rejected: ${err.message}\nReturn ONLY valid JSON matching the schema exactly. Use 0 or "" instead of null for fields you cannot fill.`;
    }
  }
  throw errors.aiOutput(`The AI could not produce valid structured output (${lastError?.message ?? 'unknown error'}).`);
}

function normalizeGroqError(err) {
  if (err?.code && err?.status) return err;
  const status = err?.status ?? err?.response?.status;
  const message = String(err?.message || 'Groq request failed');

  if (status === 401) return errors.config('Groq rejected the API key. Check GROQ_API_KEY.');
  if (status === 429 || /rate limit/i.test(message)) {
    return errors.rateLimited('Groq rate limit reached. Wait a few seconds and try again.');
  }
  if (status === 404 || /model.*not found|decommissioned/i.test(message)) {
    return errors.config(`The configured Groq model is unavailable: ${config.groq.model}. Update GROQ_MODEL.`);
  }
  if (/timeout|aborted|ETIMEDOUT/i.test(message)) {
    return errors.upstream('groq', 'The AI request timed out. Try a narrower question.');
  }
  if (/context.*length|too large|maximum context/i.test(message)) {
    return errors.badRequest('That request needs more context than the model can accept. Try a narrower question.');
  }
  if (status >= 500) return errors.upstream('groq', 'Groq is having problems right now. Please retry.');
  return err instanceof Error && err.name === 'AppError' ? err : errors.upstream('groq', message.slice(0, 200));
}
