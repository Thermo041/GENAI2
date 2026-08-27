import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { errors } from './errors.js';

const ALGO = 'aes-256-gcm';

function key() {
  const raw = Buffer.from(config.encryptionKey, 'hex');
  if (raw.length !== 32) throw errors.config('ENCRYPTION_KEY must be 32 bytes (64 hex characters).');
  return raw;
}

/**
 * AES-256-GCM envelope encryption for GitHub user tokens at rest.
 * Format: v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
 */
export function encryptSecret(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(payload) {
  if (!payload) return '';
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Timing-safe string comparison for CSRF / signature checks. */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
