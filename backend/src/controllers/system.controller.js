import { asyncHandler, ok } from '../utils/http.js';
import { config } from '../config/env.js';
import { mongoHealth } from '../config/db.js';
import { qdrantHealth } from '../config/qdrant.js';
import { groqHealth } from '../config/groq.js';
import { githubAppHealth } from '../config/github.js';
import { embeddingHealth } from '../services/embeddings/index.js';
import { CodeChange } from '../models/CodeChange.js';
import { PullRequestReview } from '../models/PullRequestReview.js';
import { IndexJob } from '../models/IndexJob.js';
import { Repository } from '../models/Repository.js';

/** GET /api/health — liveness plus a per-dependency report (no secrets). */
export const health = asyncHandler(async (req, res) => {
  const deep = req.query.deep === 'true';
  const base = {
    status: 'ok',
    env: config.env,
    uptimeSeconds: Math.round(process.uptime()),
    mongo: mongoHealth(),
  };
  if (!deep) return ok(res, base);

  const [qdrant, groq, github, embeddings] = await Promise.all([
    qdrantHealth(),
    groqHealth(),
    githubAppHealth(),
    embeddingHealth(),
  ]);

  const healthy = base.mongo.state === 'connected' && qdrant.reachable && groq.reachable && github.reachable && embeddings.reachable;
  return ok(res, {
    ...base,
    status: healthy ? 'ok' : 'degraded',
    qdrant,
    groq: { reachable: groq.reachable, models: groq.models, mainAvailable: groq.mainAvailable, error: groq.error },
    github: { reachable: github.reachable, app: github.app, permissions: github.permissions, error: github.error },
    embeddings,
  });
});

/** GET /api/activity — dashboard feed built from real records. */
export const activity = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const repositoryIds = await Repository.find({ 'accessRecords.userId': userId }).select('_id fullName').lean();
  const nameById = new Map(repositoryIds.map((r) => [r._id.toString(), r.fullName]));
  const ids = repositoryIds.map((r) => r._id);

  const [changes, reviews, jobs] = await Promise.all([
    CodeChange.find({ userId }).sort({ createdAt: -1 }).limit(12).lean(),
    PullRequestReview.find({ repositoryId: { $in: ids } }).sort({ createdAt: -1 }).limit(12).lean(),
    IndexJob.find({ repositoryId: { $in: ids } }).sort({ createdAt: -1 }).limit(12).lean(),
  ]);

  return ok(res, {
    changes: changes.map((c) => ({
      id: c._id.toString(),
      repository: nameById.get(c.repositoryId.toString()) || `${c.baseOwner}/${c.baseRepo}`,
      summary: c.summary,
      status: c.status,
      viaFork: c.viaFork,
      pullRequestNumber: c.pullRequestNumber,
      pullRequestUrl: c.pullRequestUrl,
      files: c.files.length,
      additions: c.totalAdditions,
      deletions: c.totalDeletions,
      createdAt: c.createdAt,
    })),
    reviews: reviews.map((r) => ({
      id: r._id.toString(),
      repository: `${r.owner}/${r.repo}`,
      number: r.number,
      title: r.title,
      riskLevel: r.riskLevel,
      verdict: r.verdict,
      findings: r.findings.length,
      trigger: r.trigger,
      createdAt: r.createdAt,
    })),
    jobs: jobs.map((j) => ({
      id: j._id.toString(),
      repository: nameById.get(j.repositoryId.toString()) || `${j.owner}/${j.repo}`,
      kind: j.kind,
      status: j.status,
      stage: j.stage,
      progress: j.progress,
      message: j.message,
      processedFiles: j.processedFiles,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    })),
  });
});
