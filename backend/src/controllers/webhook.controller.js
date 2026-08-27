import { asyncHandler, ok } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { Repository } from '../models/Repository.js';
import { User } from '../models/User.js';
import { WebhookDelivery } from '../models/WebhookDelivery.js';
import { enqueueJob } from '../services/indexing/jobs.js';
import { runWorkerOnce } from '../jobs/worker.js';

const HANDLED_EVENTS = new Set(['push', 'pull_request', 'installation', 'installation_repositories', 'ping']);

/**
 * POST /api/github/webhook
 *
 * Signature is verified upstream. Here we (1) deduplicate on X-GitHub-Delivery,
 * (2) translate the event into background jobs, and (3) answer 202 immediately —
 * GitHub gets a fast response and the heavy work happens in the worker.
 */
export const handleWebhook = asyncHandler(async (req, res) => {
  const { id, event, payload } = req.webhook;
  const repoFullName = payload?.repository?.full_name || '';
  const installationId = payload?.installation?.id ?? null;
  const action = payload?.action || '';

  if (event === 'ping') {
    return ok(res, { received: true, message: 'pong', zen: payload.zen }, 200);
  }

  // Deduplicate redeliveries: the unique index on deliveryId is the guard.
  if (id) {
    try {
      await WebhookDelivery.create({
        deliveryId: id,
        event,
        action,
        installationId,
        repositoryFullName: repoFullName,
        status: 'received',
      });
    } catch (err) {
      if (err?.code === 11000) {
        logger.info({ delivery: id, event }, 'Duplicate webhook delivery ignored');
        return ok(res, { received: true, duplicate: true }, 200);
      }
      throw err;
    }
  }

  if (!HANDLED_EVENTS.has(event)) {
    await markDelivery(id, 'ignored', `Unhandled event ${event}`);
    return ok(res, { received: true, handled: false }, 202);
  }

  let outcome = { status: 'ignored', detail: 'No action taken.' };

  try {
    if (event === 'push') outcome = await handlePush(payload, installationId);
    else if (event === 'pull_request') outcome = await handlePullRequest(payload, installationId, action);
    else if (event === 'installation') outcome = await handleInstallation(payload, action);
    else if (event === 'installation_repositories') outcome = await handleInstallationRepositories(payload, action);
  } catch (err) {
    logger.error({ delivery: id, event, err: err.message }, 'Webhook handling failed');
    await markDelivery(id, 'failed', err.message);
    return ok(res, { received: true, handled: false, error: 'processing_failed' }, 202);
  }

  await markDelivery(id, outcome.status === 'ignored' ? 'ignored' : 'processed', outcome.detail);
  if (outcome.status === 'queued') runWorkerOnce().catch(() => {});

  return ok(res, { received: true, event, action, outcome: outcome.status, detail: outcome.detail }, 202);
});

async function markDelivery(id, status, detail) {
  if (!id) return;
  await WebhookDelivery.updateOne(
    { deliveryId: id },
    { $set: { status, detail: String(detail || '').slice(0, 300), processedAt: new Date() } },
  ).catch(() => {});
}

/** push -> incremental re-index of exactly the files that changed. */
async function handlePush(payload, installationId) {
  const ref = payload.ref || '';
  if (!ref.startsWith('refs/heads/')) return { status: 'ignored', detail: `Ignored non-branch ref ${ref}` };
  if (payload.deleted) return { status: 'ignored', detail: 'Branch deleted; nothing to sync.' };

  const branch = ref.slice('refs/heads/'.length);
  const [owner, name] = (payload.repository?.full_name || '').split('/');
  if (!owner || !name) return { status: 'ignored', detail: 'Push payload had no repository.' };

  const repoDoc = await Repository.findOne({ owner, name });
  if (!repoDoc) return { status: 'ignored', detail: 'Repository is not tracked by CodeWeave.' };
  if (!['indexed', 'partial'].includes(repoDoc.indexingStatus)) {
    return { status: 'ignored', detail: `Repository index status is ${repoDoc.indexingStatus}.` };
  }
  const indexedBranch = repoDoc.indexedBranch || repoDoc.defaultBranch;
  if (branch !== indexedBranch) return { status: 'ignored', detail: `Push to ${branch}; CodeWeave indexed ${indexedBranch}.` };

  const added = new Set();
  const modified = new Set();
  const removed = new Set();
  for (const commit of payload.commits || []) {
    for (const path of commit.added || []) added.add(path);
    for (const path of commit.modified || []) modified.add(path);
    for (const path of commit.removed || []) removed.add(path);
  }
  // A file added then removed in the same push is a delete overall.
  for (const path of removed) {
    added.delete(path);
    modified.delete(path);
  }

  if (added.size + modified.size + removed.size === 0) {
    return { status: 'ignored', detail: 'Push contained no file changes.' };
  }

  const { job } = await enqueueJob({
    kind: 'incremental_sync',
    repositoryId: repoDoc._id,
    owner,
    repo: name,
    branch,
    commitSha: payload.after,
    force: true,
    payload: {
      installationId,
      commitSha: payload.after,
      branch,
      added: [...added],
      modified: [...modified],
      removed: [...removed],
      pusher: payload.pusher?.name || '',
    },
  });

  return {
    status: 'queued',
    detail: `Queued incremental sync job ${job._id} for ${added.size + modified.size} changed and ${removed.size} deleted file(s).`,
  };
}

/** pull_request -> queue an AI review for meaningful actions only. */
async function handlePullRequest(payload, installationId, action) {
  const reviewable = ['opened', 'reopened', 'synchronize', 'ready_for_review'];
  if (!reviewable.includes(action)) return { status: 'ignored', detail: `Ignored pull_request action "${action}".` };
  if (payload.pull_request?.draft && action !== 'ready_for_review') {
    return { status: 'ignored', detail: 'Draft pull request; review skipped.' };
  }

  const [owner, name] = (payload.repository?.full_name || '').split('/');
  const repoDoc = await Repository.findOne({ owner, name });
  if (!repoDoc) return { status: 'ignored', detail: 'Repository is not tracked by CodeWeave.' };
  if (!['indexed', 'partial'].includes(repoDoc.indexingStatus)) {
    return { status: 'ignored', detail: `Repository index status is ${repoDoc.indexingStatus}; review needs an index.` };
  }

  const { job } = await enqueueJob({
    kind: 'pr_review',
    repositoryId: repoDoc._id,
    owner,
    repo: name,
    branch: payload.pull_request?.base?.ref || '',
    commitSha: payload.pull_request?.head?.sha || '',
    force: true,
    payload: {
      installationId,
      number: payload.pull_request.number,
      headSha: payload.pull_request?.head?.sha,
      postToGithub: true,
      force: action === 'synchronize',
    },
  });

  return { status: 'queued', detail: `Queued AI review job ${job._id} for PR #${payload.pull_request.number}.` };
}

async function handleInstallation(payload, action) {
  const installationId = payload.installation?.id;
  const senderId = payload.sender?.id;
  if (!installationId || !senderId) return { status: 'ignored', detail: 'Installation payload incomplete.' };

  if (action === 'created') {
    await User.updateOne({ githubId: senderId }, { $addToSet: { installationIds: installationId } });
    return { status: 'processed', detail: `Recorded installation ${installationId}.` };
  }
  if (action === 'deleted' || action === 'suspend') {
    await User.updateMany({ installationIds: installationId }, { $pull: { installationIds: installationId } });
    return { status: 'processed', detail: `Removed installation ${installationId}.` };
  }
  return { status: 'ignored', detail: `Installation action "${action}" needs no work.` };
}

async function handleInstallationRepositories(payload, action) {
  const added = (payload.repositories_added || []).map((r) => r.full_name);
  const removed = (payload.repositories_removed || []).map((r) => r.full_name);
  logger.info({ action, added, removed }, 'Installation repositories changed');
  return {
    status: 'processed',
    detail: `Installation repositories updated (+${added.length} / -${removed.length}). Repositories are indexed on demand.`,
  };
}
