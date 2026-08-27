import { config } from '../../config/env.js';
import { errors } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { embedLocal, warmLocal, localReady } from './localProvider.js';
import { embedHf } from './hfProvider.js';

/** MiniLM sees ~256 word-pieces; anything longer is truncated by the tokenizer
 *  anyway, so we cut early to keep batches small. */
const MAX_CHARS_PER_TEXT = 2400;

function providerFn() {
  switch (config.embeddings.provider) {
    case 'local':
      return embedLocal;
    case 'hf':
      return embedHf;
    default:
      throw errors.config(`Unknown EMBEDDING_PROVIDER "${config.embeddings.provider}". Use "local" or "hf".`);
  }
}

function prepare(text) {
  const value = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!value) return ' ';
  return value.length > MAX_CHARS_PER_TEXT ? value.slice(0, MAX_CHARS_PER_TEXT) : value;
}

/**
 * Embeds an array of texts in batches. Always returns `texts.length` vectors of
 * EMBEDDING_DIM floats, or throws — never silently returns fake vectors.
 */
export async function embedTexts(texts, { onProgress } = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const embed = providerFn();
  const batchSize = Math.max(1, config.embeddings.batchSize);
  const out = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map(prepare);
    const vectors = await embed(batch);
    if (vectors.length !== batch.length) {
      throw errors.upstream('embedding', 'Embedding provider returned the wrong number of vectors.');
    }
    for (const vector of vectors) {
      if (!Array.isArray(vector) || vector.length !== config.embeddings.dim) {
        throw errors.upstream(
          'embedding',
          `Embedding provider returned ${vector?.length} dimensions, expected ${config.embeddings.dim}.`,
        );
      }
      out.push(vector);
    }
    if (onProgress) await onProgress(out.length, texts.length);
  }
  return out;
}

/**
 * Query-side embedding. MiniLM is a symmetric model, so no prefix is needed;
 * kept as a separate entry point so an asymmetric model could be swapped in.
 */
export async function embedQuery(text) {
  const [vector] = await embedTexts([text]);
  if (!vector) throw errors.upstream('embedding', 'Could not embed the query.');
  return vector;
}

export async function warmEmbeddings() {
  if (config.embeddings.provider !== 'local') return;
  try {
    await warmLocal();
  } catch (err) {
    logger.warn({ err: err.message }, 'Embedding warm-up failed; will retry on first use');
  }
}

export async function embeddingHealth() {
  try {
    const started = Date.now();
    const [vector] = await embedTexts(['codeweave health probe']);
    return {
      reachable: true,
      provider: config.embeddings.provider,
      model: config.embeddings.model,
      dim: vector.length,
      ms: Date.now() - started,
      warm: config.embeddings.provider !== 'local' ? true : localReady(),
    };
  } catch (err) {
    return { reachable: false, provider: config.embeddings.provider, error: err.message };
  }
}
