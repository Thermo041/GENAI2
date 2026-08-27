import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from './env.js';
import { logger } from '../utils/logger.js';
import { errors } from '../utils/errors.js';

let client = null;
let ensured = false;

export function getQdrant() {
  if (!config.qdrant.url || !config.qdrant.apiKey) {
    throw errors.config('Qdrant is not configured. Set QDRANT_URL and QDRANT_API_KEY.');
  }
  if (!client) {
    client = new QdrantClient({
      url: config.qdrant.url,
      apiKey: config.qdrant.apiKey,
      checkCompatibility: false,
      timeout: 30000,
    });
  }
  return client;
}

/**
 * Creates the collection (cosine, 384 dims) plus the payload indexes that make
 * per-repository filtering fast. Idempotent — safe to call on every boot.
 */
export async function ensureCollection() {
  if (ensured) return;
  const qdrant = getQdrant();
  const name = config.qdrant.collection;

  const { collections } = await qdrant.getCollections();
  const exists = collections.some((c) => c.name === name);

  if (!exists) {
    await qdrant.createCollection(name, {
      vectors: { size: config.embeddings.dim, distance: 'Cosine' },
      optimizers_config: { default_segment_number: 2 },
      on_disk_payload: true,
    });
    logger.info({ collection: name, dim: config.embeddings.dim }, 'Qdrant collection created');
  } else {
    const info = await qdrant.getCollection(name);
    const size = info?.config?.params?.vectors?.size;
    if (size && size !== config.embeddings.dim) {
      throw errors.config(
        `Qdrant collection "${name}" has vector size ${size} but EMBEDDING_DIM is ${config.embeddings.dim}. ` +
          'Use a different QDRANT_COLLECTION or recreate it.',
      );
    }
  }

  const indexes = [
    ['repositoryId', 'keyword'],
    ['owner', 'keyword'],
    ['repo', 'keyword'],
    ['commitSha', 'keyword'],
    ['indexRunId', 'keyword'],
    ['filePath', 'keyword'],
    ['language', 'keyword'],
    ['symbolType', 'keyword'],
    ['symbolName', 'keyword'],
  ];
  for (const [field, schema] of indexes) {
    try {
      await qdrant.createPayloadIndex(name, { field_name: field, field_schema: schema, wait: false });
    } catch (err) {
      const message = String(err?.message || '');
      if (!/already exists|already created/i.test(message)) {
        logger.debug({ field, err: message }, 'Qdrant payload index skipped');
      }
    }
  }
  ensured = true;
}

export async function qdrantHealth() {
  try {
    const qdrant = getQdrant();
    const info = await qdrant.getCollection(config.qdrant.collection).catch(() => null);
    return {
      reachable: true,
      collection: config.qdrant.collection,
      points: info?.points_count ?? 0,
      vectors: info?.config?.params?.vectors?.size ?? null,
    };
  } catch (err) {
    return { reachable: false, error: err.message };
  }
}
