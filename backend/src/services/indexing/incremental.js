import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { Repository } from '../../models/Repository.js';
import { CodeFile } from '../../models/CodeFile.js';
import { CodeSymbol } from '../../models/CodeSymbol.js';
import { CodeEdge } from '../../models/CodeEdge.js';
import { classifyTreeEntry, looksBinary } from '../../utils/fileFilter.js';
import { getFileContent } from '../github/contents.js';
import { analyzeFile } from '../analysis/analyzeFile.js';
import { chunkFile } from '../analysis/chunker.js';
import { buildGraph } from '../analysis/graphBuilder.js';
import { embedTexts } from '../embeddings/index.js';
import { upsertChunks, deleteFileVectors } from '../qdrant/store.js';
import { sha256 } from '../../utils/crypto.js';
import { updateJob, pushJobError } from './jobs.js';
import { octokitForJob } from './indexer.js';

/**
 * Webhook-driven incremental sync. A push touching three files re-embeds those
 * three files instead of the whole repository, which is what keeps the index
 * fresh cheaply. Chunk identity excludes the commit SHA, so replacing one
 * file's vectors never orphans the rest.
 */
export async function runIncrementalSync(job) {
  const repoDoc = await Repository.findById(job.repositoryId);
  if (!repoDoc) return { stage: 'done', message: 'Repository is no longer tracked.' };

  const { added = [], modified = [], removed = [], commitSha, branch } = job.payload || {};
  const targetBranch = branch || repoDoc.indexedBranch || repoDoc.defaultBranch;

  if (repoDoc.indexedBranch && targetBranch !== repoDoc.indexedBranch) {
    return { stage: 'done', message: `Ignored push to ${targetBranch}; CodeWeave indexed ${repoDoc.indexedBranch}.` };
  }
  if (repoDoc.indexingStatus === 'not_indexed') {
    return { stage: 'done', message: 'Repository is not indexed yet; nothing to sync.' };
  }

  const octokit = await octokitForJob(job);
  const changed = [...new Set([...added, ...modified])]
    .filter((path) => classifyTreeEntry({ path, size: 1 }, { maxFileSize: config.limits.maxFileSize }).include)
    .slice(0, 120);

  await updateJob(job._id, {
    stage: 'fetching',
    message: `Syncing ${changed.length} changed and ${removed.length} deleted file(s)…`,
    progress: 15,
    sourceFiles: changed.length,
  });

  if (removed.length) {
    await Promise.all([
      CodeFile.deleteMany({ repositoryId: repoDoc._id, filePath: { $in: removed } }),
      CodeSymbol.deleteMany({ repositoryId: repoDoc._id, filePath: { $in: removed } }),
      CodeEdge.deleteMany({ repositoryId: repoDoc._id, fromFile: { $in: removed } }),
      deleteFileVectors(repoDoc._id, removed),
    ]);
  }

  const parsedFiles = [];
  const allChunks = [];

  for (const filePath of changed) {
    try {
      const file = await getFileContent(octokit, job.owner, job.repo, filePath, commitSha || targetBranch);
      if (file.binary || !file.content || looksBinary(file.content)) continue;
      const verdict = classifyTreeEntry({ path: filePath, size: file.size }, { maxFileSize: config.limits.maxFileSize });
      if (!verdict.include) continue;

      const analysis = analyzeFile({ filePath, content: file.content, language: verdict.language });
      const chunks = chunkFile({
        filePath,
        content: file.content,
        language: verdict.language,
        analysis,
        maxChars: config.limits.maxChunkChars,
      });
      parsedFiles.push({
        filePath,
        language: verdict.language,
        analysis,
        lines: file.content.split('\n').length,
        bytes: file.content.length,
        chunkCount: chunks.length,
        contentSha: sha256(file.content).slice(0, 40),
      });
      allChunks.push(...chunks);
    } catch (err) {
      await pushJobError(job._id, filePath, err.message);
    }
  }

  await updateJob(job._id, { stage: 'embedding', message: 'Re-embedding changed files…', progress: 55 });

  if (allChunks.length) {
    await deleteFileVectors(repoDoc._id, parsedFiles.map((f) => f.filePath));
    const vectors = await embedTexts(allChunks.map((c) => c.text));
    await upsertChunks({
      repositoryId: repoDoc._id,
      owner: job.owner,
      repo: job.repo,
      branch: targetBranch,
      commitSha: commitSha || repoDoc.lastIndexedCommitSha,
      indexRunId: repoDoc.indexRunId || '',
      chunks: allChunks,
      vectors,
    });
  }

  await updateJob(job._id, { stage: 'graph', message: 'Updating the relationship graph…', progress: 80 });

  if (parsedFiles.length) {
    const changedPaths = parsedFiles.map((f) => f.filePath);
    const [existingPaths, existingSymbols] = await Promise.all([
      CodeFile.find({ repositoryId: repoDoc._id, filePath: { $nin: changedPaths } }).select('filePath').lean(),
      CodeSymbol.find({ repositoryId: repoDoc._id, filePath: { $nin: changedPaths } })
        .select('filePath name qualifiedName kind')
        .lean(),
    ]);

    const graph = buildGraph({
      repositoryId: repoDoc._id,
      commitSha: commitSha || repoDoc.lastIndexedCommitSha,
      files: parsedFiles,
      extraFilePaths: existingPaths.map((f) => f.filePath),
      extraSymbols: existingSymbols,
    });

    await Promise.all([
      CodeFile.deleteMany({ repositoryId: repoDoc._id, filePath: { $in: changedPaths } }),
      CodeSymbol.deleteMany({ repositoryId: repoDoc._id, filePath: { $in: changedPaths } }),
      CodeEdge.deleteMany({ repositoryId: repoDoc._id, fromFile: { $in: changedPaths } }),
    ]);
    await CodeFile.insertMany(graph.fileDocs, { ordered: false });
    if (graph.symbolDocs.length) await CodeSymbol.insertMany(graph.symbolDocs, { ordered: false });
    if (graph.edgeDocs.length) await CodeEdge.insertMany(graph.edgeDocs, { ordered: false });
  }

  const [fileCount, symbolCount, edgeCount] = await Promise.all([
    CodeFile.countDocuments({ repositoryId: repoDoc._id }),
    CodeSymbol.countDocuments({ repositoryId: repoDoc._id }),
    CodeEdge.countDocuments({ repositoryId: repoDoc._id }),
  ]);

  await Repository.findByIdAndUpdate(repoDoc._id, {
    $set: {
      lastIndexedCommitSha: commitSha || repoDoc.lastIndexedCommitSha,
      lastIndexedAt: new Date(),
      'indexStats.filesIndexed': fileCount,
      'indexStats.symbols': symbolCount,
      'indexStats.edges': edgeCount,
    },
  });

  logger.info(
    { repo: `${job.owner}/${job.repo}`, changed: parsedFiles.length, removed: removed.length, commit: (commitSha || '').slice(0, 7) },
    'Incremental sync complete',
  );

  return {
    stage: 'done',
    message: `Synced ${parsedFiles.length} changed and ${removed.length} deleted file(s).`,
    processedFiles: parsedFiles.length,
    chunksCreated: allChunks.length,
    embeddingsGenerated: allChunks.length,
    commitSha: commitSha || repoDoc.lastIndexedCommitSha,
  };
}
