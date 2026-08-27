import crypto from 'node:crypto';
import { getQdrant, ensureCollection } from '../../config/qdrant.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { errors } from '../../utils/errors.js';

const collection = () => config.qdrant.collection;

/** Deterministic UUIDv5 so re-indexing the same chunk overwrites its point.
 *  Deliberately excludes the commit SHA: a chunk's identity is
 *  (repository, file, position, symbol), which lets webhook-driven incremental
 *  sync replace a single file's vectors without orphaning the rest. */
export function pointId(parts) {
  const hash = crypto.createHash('sha1').update(parts.join('|')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Writes chunk vectors with the payload that scopes retrieval. Every point
 * carries repositoryId/owner/repo/commitSha so a query for repository A can
 * never surface repository B's code.
 */
export async function upsertChunks({ repositoryId, owner, repo, branch, commitSha, indexRunId = '', chunks, vectors }) {
  if (!chunks.length) return 0;
  if (chunks.length !== vectors.length) throw errors.internal('Chunk/vector count mismatch.');
  await ensureCollection();

  const points = chunks.map((chunk, i) => ({
    id: pointId([String(repositoryId), chunk.filePath, String(chunk.startLine), chunk.symbolName]),
    vector: vectors[i],
    payload: {
      repositoryId: String(repositoryId),
      owner,
      repo,
      branch,
      commitSha,
      indexRunId,
      filePath: chunk.filePath,
      language: chunk.language,
      symbolName: chunk.symbolName,
      symbolType: chunk.symbolType,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      exported: Boolean(chunk.exported),
      isTest: Boolean(chunk.isTest),
      signature: chunk.signature || '',
      code: chunk.code.slice(0, 6000),
    },
  }));

  const batchSize = 64;
  for (let i = 0; i < points.length; i += batchSize) {
    await getQdrant().upsert(collection(), { wait: i + batchSize >= points.length, points: points.slice(i, i + batchSize) });
  }
  return points.length;
}

function repoFilter(repositoryId, extra = []) {
  return { must: [{ key: 'repositoryId', match: { value: String(repositoryId) } }, ...extra] };
}

/** Vector search, always scoped to one repository (and optionally one commit). */
export async function searchChunks({ repositoryId, vector, limit = 12, commitSha, languages, filePaths, excludeTests = false, scoreThreshold = 0.15 }) {
  await ensureCollection();
  const must = [];
  if (commitSha) must.push({ key: 'commitSha', match: { value: commitSha } });
  if (languages?.length) must.push({ key: 'language', match: { any: languages } });
  if (filePaths?.length) must.push({ key: 'filePath', match: { any: filePaths } });
  const filter = repoFilter(repositoryId, must);
  if (excludeTests) filter.must_not = [{ key: 'isTest', match: { value: true } }];

  const { points } = await getQdrant().query(collection(), {
    query: vector,
    limit,
    filter,
    with_payload: true,
    score_threshold: scoreThreshold,
  });

  return (points || []).map((r) => ({
    score: r.score,
    filePath: r.payload.filePath,
    language: r.payload.language,
    symbolName: r.payload.symbolName,
    symbolType: r.payload.symbolType,
    startLine: r.payload.startLine,
    endLine: r.payload.endLine,
    signature: r.payload.signature,
    isTest: r.payload.isTest,
    code: r.payload.code,
  }));
}

export async function deleteRepositoryVectors(repositoryId) {
  await ensureCollection();
  await getQdrant().delete(collection(), { filter: repoFilter(repositoryId), wait: true });
  logger.info({ repositoryId: String(repositoryId) }, 'Deleted repository vectors');
}

/**
 * Drops every point from previous index generations of this repository. Using a
 * per-run id (not the commit SHA) means re-indexing the same commit, dropping
 * files, or shifting chunk boundaries can never leave orphaned vectors behind.
 */
export async function deleteStaleVectors(repositoryId, keepIndexRunId) {
  if (!keepIndexRunId) return;
  await ensureCollection();
  await getQdrant().delete(collection(), {
    filter: {
      must: [{ key: 'repositoryId', match: { value: String(repositoryId) } }],
      must_not: [{ key: 'indexRunId', match: { value: keepIndexRunId } }],
    },
    wait: true,
  });
}

export async function deleteFileVectors(repositoryId, filePaths) {
  if (!filePaths?.length) return;
  await ensureCollection();
  await getQdrant().delete(collection(), {
    filter: repoFilter(repositoryId, [{ key: 'filePath', match: { any: filePaths } }]),
    wait: true,
  });
}

/**
 * Structural retrieval: pull stored chunks for specific files (optionally
 * covering a specific line), without a vector query. Used by hybrid retrieval
 * and impact analysis, where the dependency graph — not similarity — decides
 * which code matters.
 */
export async function fetchChunksForFiles({ repositoryId, filePaths, limit = 40 }) {
  if (!filePaths?.length) return [];
  await ensureCollection();
  const { points } = await getQdrant().scroll(collection(), {
    filter: repoFilter(repositoryId, [{ key: 'filePath', match: { any: filePaths.slice(0, 40) } }]),
    limit,
    with_payload: true,
    with_vector: false,
  });
  return (points || []).map((p) => ({
    score: null,
    filePath: p.payload.filePath,
    language: p.payload.language,
    symbolName: p.payload.symbolName,
    symbolType: p.payload.symbolType,
    startLine: p.payload.startLine,
    endLine: p.payload.endLine,
    signature: p.payload.signature,
    isTest: p.payload.isTest,
    code: p.payload.code,
  }));
}

/**
 * Every stored chunk for a repository, newest generation first. Used as the
 * retrieval fallback for small repositories: when similarity finds nothing above
 * the threshold, a 3-chunk repository fits in the prompt whole, and answering
 * from all of it beats refusing.
 */
export async function fetchRepositoryChunks({ repositoryId, limit = 24 }) {
  await ensureCollection();
  const { points } = await getQdrant().scroll(collection(), {
    filter: repoFilter(repositoryId),
    limit,
    with_payload: true,
    with_vector: false,
  });
  return (points || []).map((p) => ({
    score: null,
    filePath: p.payload.filePath,
    language: p.payload.language,
    symbolName: p.payload.symbolName,
    symbolType: p.payload.symbolType,
    startLine: p.payload.startLine,
    endLine: p.payload.endLine,
    signature: p.payload.signature,
    isTest: p.payload.isTest,
    code: p.payload.code,
  }));
}

export async function countRepositoryVectors(repositoryId) {
  await ensureCollection();
  const { count } = await getQdrant().count(collection(), { filter: repoFilter(repositoryId), exact: true });
  return count;
}
