import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { errors } from '../../utils/errors.js';

let pipelinePromise = null;

/**
 * all-MiniLM-L6-v2 running as ONNX inside this Node process via
 * @huggingface/transformers. No third-party inference call, no extra credential.
 * The model (~25 MB, int8) is downloaded once into backend/.cache/transformers.
 */
async function getPipeline() {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = config.embeddings.cacheDir;
    env.allowLocalModels = true;
    const started = Date.now();
    const extractor = await pipeline('feature-extraction', config.embeddings.model, { dtype: 'q8' });
    logger.info(
      { model: config.embeddings.model, ms: Date.now() - started },
      'Local embedding model ready',
    );
    return extractor;
  })().catch((err) => {
    pipelinePromise = null;
    throw errors.upstream('embedding', `Could not load the local embedding model: ${err.message}`);
  });
  return pipelinePromise;
}

/** @returns {Promise<number[][]>} one L2-normalised vector per input text. */
export async function embedLocal(texts) {
  const extractor = await getPipeline();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  const dim = output.dims[output.dims.length - 1];
  const flat = output.data;
  const vectors = [];
  for (let i = 0; i < texts.length; i += 1) {
    vectors.push(Array.from(flat.slice(i * dim, (i + 1) * dim)));
  }
  return vectors;
}

export async function warmLocal() {
  await getPipeline();
}

export function localReady() {
  return pipelinePromise !== null;
}
