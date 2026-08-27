import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(here, '..', '..');

dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), quiet: true });

const str = (key, fallback = '') => (process.env[key] ?? fallback).toString().trim();
const num = (key, fallback) => {
  const raw = str(key);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (key, fallback = false) => {
  const raw = str(key).toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
};

/**
 * Reads the GitHub App private key from either an inline env var (Render) or a
 * .pem path (local dev), then normalises PKCS#1 -> PKCS#8, which is what the
 * GitHub App JWT signer expects.
 */
function loadGithubPrivateKey() {
  let pem = str('GITHUB_PRIVATE_KEY');
  if (pem) {
    pem = pem.replace(/\\n/g, '\n');
  } else {
    const keyPath = str('GITHUB_PRIVATE_KEY_PATH');
    if (!keyPath) return '';
    const resolved = path.isAbsolute(keyPath) ? keyPath : path.resolve(BACKEND_ROOT, keyPath);
    if (!fs.existsSync(resolved)) return '';
    pem = fs.readFileSync(resolved, 'utf8');
  }
  pem = pem.trim();
  if (!pem) return '';
  if (pem.includes('BEGIN PRIVATE KEY')) return pem;
  try {
    return crypto
      .createPrivateKey({ key: pem, format: 'pem' })
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
  } catch {
    return pem;
  }
}

const NODE_ENV = str('NODE_ENV', 'development');

export const config = {
  env: NODE_ENV,
  isProd: NODE_ENV === 'production',
  isTest: NODE_ENV === 'test',
  port: num('PORT', 5000),
  logLevel: str('LOG_LEVEL', NODE_ENV === 'production' ? 'info' : 'debug'),
  clientUrl: str('CLIENT_URL', 'http://localhost:5173').replace(/\/$/, ''),
  serverUrl: str('SERVER_URL', 'http://localhost:5000').replace(/\/$/, ''),
  extraOrigins: str('EXTRA_ORIGINS')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),

  mongo: { uri: str('MONGODB_URI') },

  github: {
    appId: str('GITHUB_APP_ID'),
    appSlug: str('GITHUB_APP_SLUG'),
    clientId: str('GITHUB_CLIENT_ID'),
    clientSecret: str('GITHUB_CLIENT_SECRET'),
    callbackUrl: str('GITHUB_CALLBACK_URL'),
    privateKey: loadGithubPrivateKey(),
    webhookSecret: str('GITHUB_WEBHOOK_SECRET'),
    webhookUrl: str('GITHUB_WEBHOOK_URL'),
    userAgent: 'CodeWeave/1.0',
  },

  groq: {
    apiKey: str('GROQ_API_KEY'),
    model: str('GROQ_MODEL', 'llama-3.3-70b-versatile'),
    fastModel: str('GROQ_MODEL_FAST', 'llama-3.1-8b-instant'),
    maxTokens: num('GROQ_MAX_TOKENS', 4096),
    // Free-tier Groq accounts are limited to 8k tokens per minute, which is far
    // below the model's context window. Prompt sizes are derived from this.
    tpmLimit: num('GROQ_TPM_LIMIT', 8000),
    timeoutMs: num('GROQ_TIMEOUT_MS', 90000),
  },

  qdrant: {
    url: str('QDRANT_URL'),
    apiKey: str('QDRANT_API_KEY'),
    collection: str('QDRANT_COLLECTION', 'codeweave_chunks'),
  },

  embeddings: {
    provider: str('EMBEDDING_PROVIDER', 'local'),
    model: str('EMBEDDING_MODEL', 'Xenova/all-MiniLM-L6-v2'),
    dim: num('EMBEDDING_DIM', 384),
    batchSize: num('EMBEDDING_BATCH_SIZE', 16),
    hfToken: str('HF_TOKEN'),
    cacheDir: path.join(BACKEND_ROOT, '.cache', 'transformers'),
  },

  session: {
    secret: str('SESSION_SECRET'),
    name: 'codeweave.sid',
    ttlDays: num('SESSION_TTL_DAYS', 7),
  },

  encryptionKey: str('ENCRYPTION_KEY'),

  limits: {
    maxFiles: num('MAX_FILES', 500),
    maxFileSize: num('MAX_FILE_SIZE', 180000),
    maxChunkChars: num('MAX_CHUNK_CHARS', 1800),
    maxTotalChunks: num('MAX_TOTAL_CHUNKS', 6000),
    indexConcurrency: num('INDEX_CONCURRENCY', 6),
  },

  worker: {
    enabled: bool('WORKER_ENABLED', true),
    pollMs: num('WORKER_POLL_MS', 2500),
  },
};

/** Config problems that must stop boot. */
export function validateConfig() {
  const missing = [];
  const need = {
    MONGODB_URI: config.mongo.uri,
    GITHUB_APP_ID: config.github.appId,
    GITHUB_CLIENT_ID: config.github.clientId,
    GITHUB_CLIENT_SECRET: config.github.clientSecret,
    GITHUB_PRIVATE_KEY: config.github.privateKey,
    GITHUB_CALLBACK_URL: config.github.callbackUrl,
    GROQ_API_KEY: config.groq.apiKey,
    QDRANT_URL: config.qdrant.url,
    QDRANT_API_KEY: config.qdrant.apiKey,
    SESSION_SECRET: config.session.secret,
    ENCRYPTION_KEY: config.encryptionKey,
  };
  for (const [key, value] of Object.entries(need)) if (!value) missing.push(key);
  if (config.encryptionKey && Buffer.from(config.encryptionKey, 'hex').length !== 32) {
    missing.push('ENCRYPTION_KEY (must be 64 hex chars = 32 bytes)');
  }
  if (config.embeddings.provider === 'hf' && !config.embeddings.hfToken) {
    missing.push('HF_TOKEN (required when EMBEDDING_PROVIDER=hf)');
  }
  return missing;
}
