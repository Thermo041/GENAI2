import { asyncHandler, ok } from '../utils/http.js';
import { errors } from '../utils/errors.js';
import { isSafeBranchName } from '../utils/repoIdentity.js';
import { IndexJob } from '../models/IndexJob.js';
import { Repository } from '../models/Repository.js';
import { resolveRepository } from '../services/repositoryAccess.js';
import { enqueueJob, getLatestJob, jobToStatus } from '../services/indexing/jobs.js';
import { getBranchHead } from '../services/github/repositories.js';
import { vectorCount } from '../services/repositoryView.js';
import { runWorkerOnce } from '../jobs/worker.js';
import { logger } from '../utils/logger.js';

/** POST /api/repositories/:owner/:repo/index — queue a real indexing job. */
export const startIndexing = asyncHandler(async (req, res) => {
  const { octokit, meta, doc } = await resolveRepository(req, req.params.owner, req.params.repo, { withLanguages: true });

  const branch = req.body?.branch && isSafeBranchName(req.body.branch) ? req.body.branch : doc.indexedBranch || meta.defaultBranch;
  // Resolving the branch head is also the emptiness check: GitHub's cached
  // `size` stays 0 for a while after the first push.
  let head;
  try {
    head = await getBranchHead(octokit, meta.owner, meta.name, branch);
  } catch (err) {
    if (['NOT_FOUND', 'REPO_NOT_FOUND'].includes(err.code)) {
      throw errors.conflict(`Branch "${branch}" has no commits yet, so there is nothing to index.`);
    }
    throw err;
  }
  const force = req.body?.force === true;

  if (!force && doc.lastIndexedCommitSha === head.sha && ['indexed', 'partial'].includes(doc.indexingStatus)) {
    return ok(res, {
      queued: false,
      upToDate: true,
      message: `Already indexed at commit ${head.sha.slice(0, 7)}.`,
      job: jobToStatus(await getLatestJob(doc._id)),
    });
  }

  const { job, created } = await enqueueJob({
    kind: 'full_index',
    repositoryId: doc._id,
    requestedBy: req.user._id,
    owner: meta.owner,
    repo: meta.name,
    branch,
    commitSha: head.sha,
    force,
  });

  await Repository.findByIdAndUpdate(doc._id, {
    $set: { indexingStatus: 'queued', indexedBranch: branch, defaultBranch: meta.defaultBranch },
  });

  // Nudge the in-process worker so the job starts immediately on single-instance
  // deployments instead of waiting for the next poll tick.
  runWorkerOnce().catch((err) => logger.debug({ err: err.message }, 'Worker nudge failed'));

  return ok(res, {
    queued: true,
    created,
    message: created ? 'Indexing started.' : 'Indexing is already in progress.',
    job: jobToStatus(job),
  });
});

/** GET /api/repositories/:owner/:repo/index-status */
export const getIndexStatus = asyncHandler(async (req, res) => {
  const { octokit, meta, doc } = await resolveRepository(req, req.params.owner, req.params.repo);
  const job = await getLatestJob(doc._id);
  const branch = doc.indexedBranch || meta.defaultBranch;

  let head = null;
  try {
    head = await getBranchHead(octokit, meta.owner, meta.name, branch);
  } catch {
    head = null;
  }

  return ok(res, {
    status: doc.indexingStatus,
    branch,
    indexedCommitSha: doc.lastIndexedCommitSha,
    indexedAt: doc.lastIndexedAt,
    stats: doc.indexStats,
    vectors: await vectorCount(doc._id),
    job: jobToStatus(job),
    freshness: head
      ? {
          checked: true,
          headSha: head.sha,
          stale: Boolean(doc.lastIndexedCommitSha) && head.sha !== doc.lastIndexedCommitSha,
          headMessage: head.message.split('\n')[0].slice(0, 120),
        }
      : { checked: false, stale: false },
  });
});

/**
 * GET /api/repositories/:owner/:repo/index-events — Server-Sent Events stream of
 * real job counters. Falls back gracefully: the frontend also polls.
 */
export const streamIndexEvents = asyncHandler(async (req, res) => {
  const { doc } = await resolveRepository(req, req.params.owner, req.params.repo, {});

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  const send = (event, data) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const deadline = Date.now() + 10 * 60 * 1000;
  let lastPayload = '';

  while (!closed && Date.now() < deadline) {
    const job = await IndexJob.findOne({ repositoryId: doc._id }).sort({ createdAt: -1 });
    const status = jobToStatus(job);
    const payload = JSON.stringify(status);
    if (payload !== lastPayload) {
      lastPayload = payload;
      send('progress', status);
    }
    if (!job || ['completed', 'failed', 'cancelled'].includes(job.status)) {
      const repo = await Repository.findById(doc._id).select('indexingStatus lastIndexedCommitSha indexStats').lean();
      send('done', { status: repo?.indexingStatus, commitSha: repo?.lastIndexedCommitSha, stats: repo?.indexStats, job: status });
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (!closed) res.end();
});

/** GET /api/repositories/:owner/:repo/jobs — recent job history. */
export const listJobs = asyncHandler(async (req, res) => {
  const { doc } = await resolveRepository(req, req.params.owner, req.params.repo);
  const jobs = await IndexJob.find({ repositoryId: doc._id }).sort({ createdAt: -1 }).limit(15);
  return ok(res, { jobs: jobs.map(jobToStatus) });
});
