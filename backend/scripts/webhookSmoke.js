#!/usr/bin/env node
/**
 * Verifies the GitHub webhook endpoint end-to-end against a running server:
 * signature verification, delivery deduplication, and the routing decisions for
 * push / pull_request / installation events.
 *
 * Usage: npm start (in another shell), then: node scripts/webhookSmoke.js
 */
import crypto from 'node:crypto';
import { config } from '../src/config/env.js';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Repository } from '../src/models/Repository.js';
import { IndexJob } from '../src/models/IndexJob.js';
import { WebhookDelivery } from '../src/models/WebhookDelivery.js';

const BASE = process.env.SMOKE_BASE_URL || config.serverUrl;
const results = [];
const check = (label, pass, detail = '') => {
  results.push(pass);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

function sign(body) {
  return `sha256=${crypto.createHmac('sha256', config.github.webhookSecret).update(body).digest('hex')}`;
}

async function post({ event, payload, delivery, signature }) {
  const body = JSON.stringify(payload);
  const res = await fetch(`${BASE}/api/github/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      'X-GitHub-Delivery': delivery,
      'X-Hub-Signature-256': signature ?? sign(body),
    },
    body,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

await connectMongo();

const tracked = await Repository.findOne({ indexingStatus: { $in: ['indexed', 'partial'] } }).sort({ updatedAt: -1 });
if (!tracked) {
  console.error('No indexed repository found. Run scripts/e2eVerify.js first.');
  process.exit(1);
}
const fullName = tracked.fullName;
const indexedBranch = tracked.indexedBranch || tracked.defaultBranch;
const repositoryPayload = { full_name: fullName, name: tracked.name, owner: { login: tracked.owner } };
const stamp = Date.now();

console.log(`\nWebhook smoke test against ${BASE}\nrepository: ${fullName} (indexed branch ${indexedBranch})\n${'='.repeat(64)}`);

// 1. ping
const ping = await post({ event: 'ping', delivery: `smoke-ping-${stamp}`, payload: { zen: 'Keep it logically awesome.' } });
check('ping is acknowledged', ping.status === 200 && ping.body?.data?.message === 'pong');

// 2. invalid signature is rejected
const bad = await post({
  event: 'push',
  delivery: `smoke-bad-${stamp}`,
  payload: { ref: 'refs/heads/main', repository: repositoryPayload },
  signature: 'sha256=deadbeef',
});
check('invalid signature is rejected with 403', bad.status === 403, bad.body?.error?.code);

// 3. missing signature is rejected
const unsigned = await fetch(`${BASE}/api/github/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'push', 'X-GitHub-Delivery': `smoke-unsigned-${stamp}` },
  body: JSON.stringify({ ref: 'refs/heads/main' }),
});
check('missing signature is rejected with 403', unsigned.status === 403);

// 4. push to a branch CodeWeave did not index is ignored
const otherBranch = await post({
  event: 'push',
  delivery: `smoke-otherbranch-${stamp}`,
  payload: {
    ref: 'refs/heads/some-feature-branch',
    after: 'a'.repeat(40),
    repository: repositoryPayload,
    pusher: { name: 'smoke' },
    commits: [{ added: ['src/x.js'], modified: [], removed: [] }],
  },
});
check(
  'push to a non-indexed branch is ignored',
  otherBranch.status === 202 && otherBranch.body?.data?.outcome === 'ignored',
  otherBranch.body?.data?.detail,
);

// 5. duplicate delivery id is deduplicated
const duplicate = await post({
  event: 'push',
  delivery: `smoke-otherbranch-${stamp}`,
  payload: { ref: 'refs/heads/some-feature-branch', repository: repositoryPayload, commits: [] },
});
check('duplicate delivery is deduplicated', duplicate.body?.data?.duplicate === true);

// 6. push with no file changes is ignored
const empty = await post({
  event: 'push',
  delivery: `smoke-empty-${stamp}`,
  payload: {
    ref: `refs/heads/${indexedBranch}`,
    after: 'b'.repeat(40),
    repository: repositoryPayload,
    commits: [{ added: [], modified: [], removed: [] }],
  },
});
check('push with no file changes is ignored', empty.body?.data?.outcome === 'ignored', empty.body?.data?.detail);

// 7. push to the indexed branch queues an incremental sync
const queued = await post({
  event: 'push',
  delivery: `smoke-push-${stamp}`,
  payload: {
    ref: `refs/heads/${indexedBranch}`,
    after: 'c'.repeat(40),
    repository: repositoryPayload,
    pusher: { name: 'smoke' },
    commits: [
      { added: ['src/services/new.service.js'], modified: ['src/app.js'], removed: [] },
      { added: [], modified: ['src/app.js'], removed: ['src/old.js'] },
    ],
  },
});
check('push to the indexed branch queues an incremental sync', queued.body?.data?.outcome === 'queued', queued.body?.data?.detail);

const syncJob = await IndexJob.findOne({ repositoryId: tracked._id, kind: 'incremental_sync' }).sort({ createdAt: -1 });
check(
  'sync job carries the deduplicated file lists',
  Boolean(syncJob) &&
    syncJob.payload.added.length === 1 &&
    syncJob.payload.modified.length === 1 &&
    syncJob.payload.removed.length === 1,
  syncJob ? `added=${syncJob.payload.added} modified=${syncJob.payload.modified} removed=${syncJob.payload.removed}` : 'no job',
);

// 8. draft pull requests are skipped, real ones queue a review
const draft = await post({
  event: 'pull_request',
  delivery: `smoke-pr-draft-${stamp}`,
  payload: { action: 'opened', repository: repositoryPayload, pull_request: { number: 1, draft: true, head: { sha: 'd'.repeat(40) }, base: { ref: indexedBranch } } },
});
check('draft pull request is skipped', draft.body?.data?.outcome === 'ignored', draft.body?.data?.detail);

const prQueued = await post({
  event: 'pull_request',
  delivery: `smoke-pr-${stamp}`,
  payload: { action: 'opened', repository: repositoryPayload, pull_request: { number: 4242, draft: false, head: { sha: 'e'.repeat(40) }, base: { ref: indexedBranch } } },
});
check('opened pull request queues an AI review', prQueued.body?.data?.outcome === 'queued', prQueued.body?.data?.detail);

// 9. unhandled events are acknowledged but not processed
const star = await post({ event: 'star', delivery: `smoke-star-${stamp}`, payload: { action: 'created', repository: repositoryPayload } });
check('unhandled event is acknowledged without work', star.status === 202 && star.body?.data?.handled === false);

// Clean up the jobs this smoke test queued so the worker does not run them.
const cancelled = await IndexJob.updateMany(
  { repositoryId: tracked._id, status: { $in: ['queued', 'running'] }, kind: { $in: ['incremental_sync', 'pr_review'] } },
  { $set: { status: 'cancelled', stage: 'cancelled', message: 'Cancelled by webhook smoke test.' } },
);
await WebhookDelivery.deleteMany({ deliveryId: { $regex: `^smoke-.*-${stamp}$` } });
console.log(`  (cleanup: cancelled ${cancelled.modifiedCount} queued job(s), removed smoke delivery records)`);

const failed = results.filter((r) => !r).length;
console.log('='.repeat(64));
console.log(failed === 0 ? `All ${results.length} webhook checks passed.\n` : `${failed} of ${results.length} checks failed.\n`);

await disconnectMongo();
process.exit(failed === 0 ? 0 : 1);
