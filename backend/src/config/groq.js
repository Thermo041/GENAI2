import { ChatGroq } from '@langchain/groq';
import { config } from './env.js';
import { errors } from '../utils/errors.js';

const cache = new Map();

/**
 * Single place where Groq chat models are constructed. `tier` picks between the
 * high-quality reasoning model and the fast/cheap one used for summaries.
 */
export function getChatModel({ tier = 'main', temperature = 0.1, maxTokens, json = false } = {}) {
  if (!config.groq.apiKey) throw errors.config('Groq is not configured. Set GROQ_API_KEY.');
  const model = tier === 'fast' ? config.groq.fastModel : config.groq.model;
  const tokens = maxTokens ?? config.groq.maxTokens;
  const key = `${model}:${temperature}:${tokens}:${json}`;
  if (cache.has(key)) return cache.get(key);

  const instance = new ChatGroq({
    apiKey: config.groq.apiKey,
    model,
    temperature,
    maxTokens: tokens,
    maxRetries: 2,
    timeout: config.groq.timeoutMs,
    ...(json ? { modelKwargs: { response_format: { type: 'json_object' } } } : {}),
  });
  cache.set(key, instance);
  return instance;
}

export function groqModelNames() {
  return { main: config.groq.model, fast: config.groq.fastModel };
}

/** Lightweight reachability probe used by /api/health and scripts/checkServices. */
export async function groqHealth() {
  if (!config.groq.apiKey) return { reachable: false, error: 'GROQ_API_KEY missing' };
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${config.groq.apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` };
    const body = await res.json();
    const ids = (body.data || []).map((m) => m.id);
    return {
      reachable: true,
      models: groqModelNames(),
      mainAvailable: ids.includes(config.groq.model),
      fastAvailable: ids.includes(config.groq.fastModel),
      available: ids,
    };
  } catch (err) {
    return { reachable: false, error: err.message };
  }
}
