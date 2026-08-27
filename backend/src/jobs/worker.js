import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { Repository } from '../models/Repository.js';
import { claimNextJob, completeJob, failJob, updateJob } from '../services/indexing/jobs.js';
import { runFullIndex, octokitForJob } from '../services/indexing/indexer.js';
import { runIncrementalSync } from '../services/indexing/incremental.js';
import { reviewPullRequest } from '../services/pullRequests/review.js';
import { getRepository } from '../services/github/repositories.js';

let running = false;
let timer = null;
let stopped = false;

const HANDLERS = {
  full_index: runFullIndex,
  incremental_sync: runIncrementalSync,
  pr_review: runPrReviewJob,
};

async function runPrReviewJob(job) {
  const repoDoc = await Repository.findById(job.repositoryId);
  if (!repoDoc) return { stage: 'done', message: 'Repository is no longer tracked.' };
  const octokit = await octokitForJob(job);
  const meta = await getRepository(octokit, job.owner, job.repo);
  const { review } = await reviewPullRequest({
    repositoryDoc: repoDoc,
    octokit,
    meta,
    number: job.payload.number,
    userId: job.requestedBy,
    trigger: 'webhook',
    postToGithub: job.payload.postToGithub !== false,
    force: Boolean(job.payload.force),
  });
  return {
    stage: 'done',
    message: `Reviewed PR #${job.payload.number}: ${review.findings.length} finding(s), risk ${review.riskLevel}.`,
  };
}

/**
 * Claims and processes at most one job. Called by the polling loop, and also
 * directly after a user starts indexing so work begins immediately.
 */
export async function runWorkerOnce({ force = false } = {}) {
  if (!config.worker.enabled && !force) return false;
  if (running) return false;
  running = true;
  let job = null;
  try {
    job = await claimNextJob();
    if (!job) return false;

    logger.info({ jobId: job._id.toString(), kind: job.kind, repo: `${job.owner}/${job.repo}` }, 'Job started');
    const handler = HANDLERS[job.kind];
    if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);

    const result = await handler(job);
    await completeJob(job._id, result || {});
    logger.info({ jobId: job._id.toString(), kind: job.kind }, 'Job completed');
    return true;
  } catch (err) {
    if (job) {
      await failJob(job._id, err.message);
      if (job.kind === 'full_index') {
        await Repository.findByIdAndUpdate(job.repositoryId, { $set: { indexingStatus: 'failed' } }).catch(() => {});
      }
    } else {
      logger.error({ err: err.message }, 'Worker error with no claimed job');
    }
    return true;
  } finally {
    running = false;
  }
}

/** In-process worker loop — keeps the Render free tier to a single service. */
export function startWorker() {
  if (!config.worker.enabled || timer) return;
  stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      let didWork = await runWorkerOnce();
      // Drain the queue before sleeping again.
      let guard = 0;
      while (didWork && !stopped && guard < 5) {
        didWork = await runWorkerOnce();
        guard += 1;
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Worker tick failed');
    }
    if (!stopped) timer = setTimeout(tick, config.worker.pollMs);
  };
  timer = setTimeout(tick, 1500);
  logger.info({ pollMs: config.worker.pollMs }, 'Background worker started');
}

export function stopWorker() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Marks jobs that were running when the process died, so they can be retried. */
export async function recoverStuckJobs() {
  const { IndexJob } = await import('../models/IndexJob.js');
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const result = await IndexJob.updateMany(
    { status: 'running', heartbeatAt: { $lt: cutoff } },
    { $set: { status: 'queued', stage: 'requeued', message: 'Requeued after worker restart.' } },
  );
  if (result.modifiedCount) logger.warn({ count: result.modifiedCount }, 'Requeued stuck jobs');
}

export { updateJob };
