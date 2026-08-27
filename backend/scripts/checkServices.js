#!/usr/bin/env node
/**
 * Verifies every external dependency CodeWeave needs, using the real
 * credentials in .env. Run: npm run check:services
 */
import { config, validateConfig } from '../src/config/env.js';
import { connectMongo, disconnectMongo, mongoHealth } from '../src/config/db.js';
import { ensureCollection, qdrantHealth } from '../src/config/qdrant.js';
import { groqHealth } from '../src/config/groq.js';
import { githubAppHealth } from '../src/config/github.js';
import { embeddingHealth } from '../src/services/embeddings/index.js';

const line = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(22)} ${detail ?? ''}`);
  return ok;
};

const results = [];

console.log(`\nCodeWeave service check — env=${config.env}\n${'='.repeat(64)}`);

const missing = validateConfig();
results.push(line('config', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : 'all required vars present'));

try {
  await connectMongo();
  const health = mongoHealth();
  results.push(line('mongodb', health.state === 'connected', `db=${health.db}`));
} catch (err) {
  results.push(line('mongodb', false, err.message));
}

try {
  await ensureCollection();
  const health = await qdrantHealth();
  results.push(line('qdrant', health.reachable, `collection=${health.collection} points=${health.points} dim=${health.vectors}`));
} catch (err) {
  results.push(line('qdrant', false, err.message));
}

const groq = await groqHealth();
results.push(
  line(
    'groq',
    groq.reachable && groq.mainAvailable && groq.fastAvailable,
    groq.reachable
      ? `main=${groq.models.main}${groq.mainAvailable ? '' : ' (UNAVAILABLE)'} fast=${groq.models.fast}${groq.fastAvailable ? '' : ' (UNAVAILABLE)'}`
      : groq.error,
  ),
);

const github = await githubAppHealth();
results.push(
  line(
    'github app',
    github.reachable,
    github.reachable
      ? `slug=${github.app} permissions=${Object.entries(github.permissions || {}).map(([k, v]) => `${k}:${v}`).join(',')}`
      : github.error,
  ),
);

const embeddings = await embeddingHealth();
results.push(
  line(
    'embeddings',
    embeddings.reachable && embeddings.dim === config.embeddings.dim,
    embeddings.reachable ? `provider=${embeddings.provider} model=${embeddings.model} dim=${embeddings.dim} ms=${embeddings.ms}` : embeddings.error,
  ),
);

await disconnectMongo();

const failed = results.filter((r) => !r).length;
console.log('='.repeat(64));
console.log(failed === 0 ? 'All services reachable.\n' : `${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
