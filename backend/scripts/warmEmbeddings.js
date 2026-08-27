#!/usr/bin/env node
/** Downloads + warms the local embedding model so the first index is fast. */
import { config } from '../src/config/env.js';
import { embeddingHealth } from '../src/services/embeddings/index.js';

console.log(`Warming embeddings: provider=${config.embeddings.provider} model=${config.embeddings.model}`);
const health = await embeddingHealth();
if (!health.reachable) {
  console.error(`FAILED: ${health.error}`);
  process.exit(1);
}
console.log(`OK: ${health.dim} dimensions in ${health.ms}ms (cache: ${config.embeddings.cacheDir})`);
process.exit(0);
