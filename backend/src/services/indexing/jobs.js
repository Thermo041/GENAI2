import os from 'node:os';
import { IndexJob } from '../../models/IndexJob.js';
import { logger } from '../../utils/logger.js';

const WORKER_ID = `${os.hostname()}:${process.pid}`;
const STALE_MS = 5 * 60 * 1000;

/** Enqueue a job, reusing an existing queued/running job for the same target. */
export async function enqueueJob({ kind, repositoryId, requestedBy, owner, repo, branch, commitSha, payload, force = false }) {
  const active = await IndexJob.findOne({
    repositoryId,
    kind,
    status: { $in: ['queued', 'running'] },
  }).sort({ createdAt: -1 });

  if (active && !force) return { job: active, created: false };

  const job = await IndexJob.create({
    kind,
    repositoryId,
    requestedBy: requestedBy || null,
    owner,
    repo,
    branch: branch || '',
    commitSha: commitSha || '',
    payload,
    status: 'queued',
    stage: 'queued',
    message: 'Waiting for a worker…',
    progress: 0,
  });
  logger.info({ jobId: job._id.toString(), kind, repo: `${owner}/${repo}` }, 'Job queued');
  return { job, created: true };
}

/**
 * Atomically claims the oldest queued job (or a stale running job whose worker
 * died). findOneAndUpdate is the lock — safe with multiple Render instances.
 */
export async function claimNextJob() {
  const now = new Date();
  return IndexJob.findOneAndUpdate(
    {
      $or: [
        { status: 'queued' },
        { status: 'running', heartbeatAt: { $lt: new Date(now.getTime() - STALE_MS) } },
      ],
    },
    {
      $set: { status: 'running', lockedBy: WORKER_ID, heartbeatAt: now, startedAt: now, stage: 'starting' },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, returnDocument: 'after' },
  );
}

export async function updateJob(jobId, patch) {
  return IndexJob.findByIdAndUpdate(jobId, { $set: { ...patch, heartbeatAt: new Date() } }, { returnDocument: 'after' });
}

export async function pushJobError(jobId, filePath, message) {
  return IndexJob.findByIdAndUpdate(jobId, {
    $push: { issues: { $each: [{ filePath, message: String(message).slice(0, 300), at: new Date() }], $slice: -50 } },
  });
}

export async function completeJob(jobId, patch = {}) {
  return updateJob(jobId, { status: 'completed', stage: 'done', progress: 100, completedAt: new Date(), ...patch });
}

export async function failJob(jobId, message, patch = {}) {
  logger.warn({ jobId: String(jobId), message }, 'Job failed');
  return updateJob(jobId, {
    status: 'failed',
    stage: 'failed',
    message: String(message).slice(0, 300),
    completedAt: new Date(),
    ...patch,
  });
}

export async function getLatestJob(repositoryId, kind = 'full_index') {
  return IndexJob.findOne({ repositoryId, kind }).sort({ createdAt: -1 });
}

export function jobToStatus(job) {
  if (!job) return null;
  return {
    id: job._id.toString(),
    kind: job.kind,
    status: job.status,
    stage: job.stage,
    message: job.message,
    progress: job.progress,
    branch: job.branch,
    commitSha: job.commitSha,
    totalFiles: job.totalFiles,
    sourceFiles: job.sourceFiles,
    processedFiles: job.processedFiles,
    skippedFiles: job.skippedFiles,
    chunksCreated: job.chunksCreated,
    embeddingsGenerated: job.embeddingsGenerated,
    symbolsExtracted: job.symbolsExtracted,
    edgesExtracted: job.edgesExtracted,
    issues: (job.issues || []).slice(-10).map((e) => ({ filePath: e.filePath, message: e.message })),
    attempts: job.attempts,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
  };
}
