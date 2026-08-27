import pLimit from 'p-limit';
import { nanoid } from 'nanoid';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { errors } from '../../utils/errors.js';
import { Repository } from '../../models/Repository.js';
import { CodeFile } from '../../models/CodeFile.js';
import { CodeSymbol } from '../../models/CodeSymbol.js';
import { CodeEdge } from '../../models/CodeEdge.js';
import { octokitForInstallation, octokitForUser } from '../github/client.js';
import { getPublicOctokit } from '../../config/github.js';
import { getRepository, getBranchHead } from '../github/repositories.js';
import { getTree, getBlobContent } from '../github/contents.js';
import { looksBinary } from '../../utils/fileFilter.js';
import { analyzeFile } from '../analysis/analyzeFile.js';
import { chunkFile } from '../analysis/chunker.js';
import { buildGraph } from '../analysis/graphBuilder.js';
import { embedTexts } from '../embeddings/index.js';
import { upsertChunks, deleteStaleVectors } from '../qdrant/store.js';
import { sha256 } from '../../utils/crypto.js';
import { updateJob, pushJobError } from './jobs.js';
import { selectFiles } from './fileSelection.js';
import { isManifest, newManifest, parseManifestInto } from '../analysis/manifest.js';

const EMBED_FLUSH_SIZE = 96;

/** Resolves the GitHub client a background job should act as. */
export async function octokitForJob(job) {
  if (job.payload?.installationId) return octokitForInstallation(job.payload.installationId);
  if (job.requestedBy) return octokitForUser(job.requestedBy);
  // Public repositories need no credential (anonymous 60 req/h) — used by the
  // verification script and as a last resort for public-only jobs.
  if (job.payload?.publicOnly) return getPublicOctokit();
  throw errors.internal('Job has no GitHub identity to act as.');
}

/**
 * Full repository index:
 *   metadata -> branch head -> tree -> filter -> fetch -> AST parse -> chunk ->
 *   embed -> Qdrant -> relationship graph -> Mongo.
 * Progress is written to the IndexJob after every batch, so the UI shows real
 * counters rather than an animation.
 */
export async function runFullIndex(job) {
  const started = Date.now();
  const repoDoc = await Repository.findById(job.repositoryId);
  if (!repoDoc) throw errors.notFound('Repository record disappeared.');

  const indexRunId = nanoid(12);
  const octokit = await octokitForJob(job);
  const owner = job.owner;
  const repo = job.repo;

  await updateJob(job._id, { stage: 'metadata', message: 'Reading repository metadata…', progress: 2 });
  const meta = await getRepository(octokit, owner, repo);

  const branch = job.branch || repoDoc.defaultBranch || meta.defaultBranch;
  // GitHub's `size` field lags behind a push, so emptiness is decided by whether
  // the branch actually resolves — that also catches a wrong branch name.
  let head;
  try {
    head = await getBranchHead(octokit, owner, repo, branch);
  } catch (err) {
    if (['NOT_FOUND', 'REPO_NOT_FOUND'].includes(err.code)) {
      throw errors.conflict(`Branch "${branch}" has no commits yet, so there is nothing to index.`);
    }
    throw err;
  }

  await Repository.findByIdAndUpdate(repoDoc._id, {
    $set: { indexingStatus: 'indexing', indexedBranch: branch, defaultBranch: meta.defaultBranch },
  });
  await updateJob(job._id, { stage: 'tree', message: 'Listing repository files…', progress: 5, branch, commitSha: head.sha });

  const tree = await getTree(octokit, owner, repo, head.sha);
  const selection = selectFiles(tree.entries, {
    maxFiles: config.limits.maxFiles,
    maxFileSize: config.limits.maxFileSize,
    truncated: tree.truncated,
  });

  await updateJob(job._id, {
    stage: 'fetching',
    message: `Indexing ${selection.selected.length} source files…`,
    progress: 8,
    totalFiles: selection.discovered,
    sourceFiles: selection.selected.length,
    skippedFiles: selection.skipped.length,
  });

  const limit = pLimit(config.limits.indexConcurrency);
  const parsedFiles = [];
  const counters = { processed: 0, chunks: 0, embedded: 0, symbols: 0 };
  const manifest = newManifest();
  let pending = [];

  const flush = async (force = false) => {
    if (!pending.length || (!force && pending.length < EMBED_FLUSH_SIZE)) return;
    const batch = pending;
    pending = [];
    const vectors = await embedTexts(batch.map((c) => c.text));
    await upsertChunks({
      repositoryId: repoDoc._id,
      owner,
      repo,
      branch,
      commitSha: head.sha,
      indexRunId,
      chunks: batch,
      vectors,
    });
    counters.embedded += batch.length;
    const ratio = counters.processed / Math.max(1, selection.selected.length);
    await updateJob(job._id, {
      stage: 'embedding',
      message: `Embedded ${counters.embedded} chunks from ${counters.processed} files…`,
      progress: Math.min(84, 8 + Math.round(ratio * 76)),
      processedFiles: counters.processed,
      chunksCreated: counters.chunks,
      embeddingsGenerated: counters.embedded,
      symbolsExtracted: counters.symbols,
    });
  };

  const tasks = selection.selected.map((entry) =>
    limit(async () => {
      try {
        const content = await getBlobContent(octokit, owner, repo, entry.sha);
        if (!content || looksBinary(content)) {
          counters.processed += 1;
          return;
        }
        if (isManifest(entry.path)) parseManifestInto(manifest, entry.path, content);
        const analysis = analyzeFile({ filePath: entry.path, content, language: entry.language });
        const chunks = chunkFile({
          filePath: entry.path,
          content,
          language: entry.language,
          analysis,
          maxChars: config.limits.maxChunkChars,
        });
        const allowed = Math.max(0, config.limits.maxTotalChunks - counters.chunks);
        const capped = chunks.slice(0, allowed);

        parsedFiles.push({
          filePath: entry.path,
          language: entry.language,
          analysis,
          lines: content.split('\n').length,
          bytes: content.length,
          chunkCount: capped.length,
          contentSha: sha256(content).slice(0, 40),
        });
        counters.chunks += capped.length;
        counters.symbols += analysis.symbols.length;
        counters.processed += 1;
        pending.push(...capped);
        await flush(false);
      } catch (err) {
        counters.processed += 1;
        await pushJobError(job._id, entry.path, err.message);
        logger.debug({ file: entry.path, err: err.message }, 'File skipped during indexing');
      }
    }),
  );

  await Promise.all(tasks);
  await flush(true);

  await updateJob(job._id, { stage: 'graph', message: 'Building the code relationship graph…', progress: 88 });
  const graph = buildGraph({ repositoryId: repoDoc._id, commitSha: head.sha, files: parsedFiles });
  await replaceGraph(repoDoc._id, graph);

  await updateJob(job._id, { stage: 'cleanup', message: 'Removing stale vectors…', progress: 95 });
  await deleteStaleVectors(repoDoc._id, indexRunId);

  const stats = {
    filesDiscovered: selection.discovered,
    sourceFiles: selection.selected.length,
    filesIndexed: parsedFiles.length,
    filesSkipped: selection.skipped.length,
    chunks: counters.chunks,
    symbols: graph.symbolDocs.length,
    edges: graph.edgeDocs.length,
    truncated: selection.truncated,
  };

  await Repository.findByIdAndUpdate(repoDoc._id, {
    $set: {
      indexingStatus: selection.truncated ? 'partial' : 'indexed',
      indexedBranch: branch,
      lastIndexedCommitSha: head.sha,
      lastIndexedAt: new Date(),
      indexRunId,
      indexStats: stats,
      manifest,
    },
  });

  logger.info(
    { repo: `${owner}/${repo}`, branch, commit: head.sha.slice(0, 7), ...stats, ms: Date.now() - started },
    'Repository indexed',
  );

  return {
    stage: 'done',
    message: selection.truncated
      ? `Indexed ${parsedFiles.length} of ${selection.sourceCount} source files (repository is large — CodeWeave indexed the most relevant files).`
      : `Indexed ${parsedFiles.length} files, ${counters.chunks} chunks, ${graph.symbolDocs.length} symbols.`,
    commitSha: head.sha,
    branch,
    processedFiles: parsedFiles.length,
    chunksCreated: counters.chunks,
    embeddingsGenerated: counters.embedded,
    symbolsExtracted: graph.symbolDocs.length,
    edgesExtracted: graph.edgeDocs.length,
  };
}

/** Replaces the whole stored graph for a repository in one pass. */
async function replaceGraph(repositoryId, graph) {
  await Promise.all([
    CodeFile.deleteMany({ repositoryId }),
    CodeSymbol.deleteMany({ repositoryId }),
    CodeEdge.deleteMany({ repositoryId }),
  ]);
  const insert = async (Model, docs) => {
    for (let i = 0; i < docs.length; i += 1000) {
      await Model.insertMany(docs.slice(i, i + 1000), { ordered: false });
    }
  };
  await insert(CodeFile, graph.fileDocs);
  await insert(CodeSymbol, graph.symbolDocs);
  await insert(CodeEdge, graph.edgeDocs);
}
