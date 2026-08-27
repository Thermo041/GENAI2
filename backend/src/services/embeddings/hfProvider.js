import { config } from '../../config/env.js';
import { errors } from '../../utils/errors.js';

const ENDPOINT = 'https://router.huggingface.co/hf-inference/models';

/**
 * Optional alternative to local inference: Hugging Face hosted feature
 * extraction for the same all-MiniLM-L6-v2 weights. Enabled with
 * EMBEDDING_PROVIDER=hf + HF_TOKEN. Kept so the embedding layer is swappable
 * without touching indexing or retrieval code.
 */
export async function embedHf(texts) {
  if (!config.embeddings.hfToken) {
    throw errors.config('EMBEDDING_PROVIDER=hf requires HF_TOKEN.');
  }
  const model = config.embeddings.model.replace(/^Xenova\//, 'sentence-transformers/');
  const res = await fetch(`${ENDPOINT}/${model}/pipeline/feature-extraction`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.embeddings.hfToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw errors.upstream('embedding', `Hugging Face inference failed (HTTP ${res.status}). ${detail.slice(0, 200)}`);
  }

  const body = await res.json();
  if (!Array.isArray(body) || !Array.isArray(body[0])) {
    throw errors.upstream('embedding', 'Unexpected embedding response shape from Hugging Face.');
  }
  return body.map(normalize);
}

function normalize(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / magnitude);
}
