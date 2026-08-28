import { getBranchHead } from './github/repositories.js';
import { countRepositoryVectors } from './qdrant/store.js';
import { summarizeAccess } from './repositoryAccess.js';
import { viewerCoversOwner, viewerInstallationAccounts } from './github/installation.js';
import { getLatestJob, jobToStatus } from './indexing/jobs.js';

/**
 * The single repository payload the frontend consumes: GitHub metadata +
 * GitHub-derived access mode + index state + staleness. Freshness is checked
 * against the live branch head so stale analysis is never presented silently.
 */
export async function buildRepositoryView({ meta, doc, octokit, includeFreshness = true, userId = null, userHasInstallation = null }) {
  const branch = doc.indexedBranch || meta.defaultBranch;
  let freshness = { checked: false, stale: false, headSha: '', indexedSha: doc.lastIndexedCommitSha || '' };

  if (includeFreshness) {
    try {
      const head = await getBranchHead(octokit, meta.owner, meta.name, branch);
      freshness = {
        checked: true,
        headSha: head.sha,
        indexedSha: doc.lastIndexedCommitSha || '',
        stale: Boolean(doc.lastIndexedCommitSha) && head.sha !== doc.lastIndexedCommitSha,
        headMessage: head.message.split('\n')[0].slice(0, 120),
        headAuthor: head.author,
        headCommittedAt: head.committedAt,
      };
    } catch {
      freshness.checked = false;
    }
  }

  // Only relevant when the user cannot push: a user token can only fork a
  // repository its own installation covers, so check that before offering it.
  let viewerCoversSource = true;
  if (!meta.permissions.canWrite && userId) {
    const accounts = await viewerInstallationAccounts(octokit, userId);
    viewerCoversSource = viewerCoversOwner(accounts, meta.owner);
  }
  const job = await getLatestJob(doc._id, 'full_index');

  return {
    id: doc._id.toString(),
    githubRepositoryId: meta.githubRepositoryId,
    owner: meta.owner,
    name: meta.name,
    fullName: meta.fullName,
    description: meta.description,
    url: meta.url,
    visibility: meta.visibility,
    isPrivate: meta.isPrivate,
    isFork: meta.isFork,
    isArchived: meta.isArchived,
    isEmpty: meta.isEmpty,
    parentFullName: meta.parentFullName,
    defaultBranch: meta.defaultBranch,
    primaryLanguage: meta.primaryLanguage,
    stars: meta.stars,
    forks: meta.forks,
    openIssues: meta.openIssues,
    topics: meta.topics,
    ownerAvatar: meta.ownerAvatar,
    pushedAt: meta.pushedAt,
    access: { ...summarizeAccess(meta, { viewerCoversSource, userHasInstallation }), permissions: meta.permissions },
    index: {
      status: doc.indexingStatus,
      branch: doc.indexedBranch,
      commitSha: doc.lastIndexedCommitSha,
      indexedAt: doc.lastIndexedAt,
      stats: doc.indexStats,
      job: jobToStatus(job),
    },
    freshness,
    hasOverview: Boolean(doc.overview?.summary),
  };
}

/** Compact card used on the dashboard list. */
export function toRepositoryCard(doc, userId) {
  const record = (doc.accessRecords || []).find((r) => r.userId?.toString() === userId?.toString());
  const permissions = record?.permissions || {};
  const canWrite = Boolean(permissions.push || permissions.maintain || permissions.admin);
  return {
    id: doc._id.toString(),
    owner: doc.owner,
    name: doc.name,
    fullName: doc.fullName,
    description: doc.description,
    visibility: doc.visibility,
    isFork: doc.isFork,
    defaultBranch: doc.defaultBranch,
    primaryLanguage: doc.primaryLanguage,
    stars: doc.stars,
    updatedAt: doc.updatedAt,
    pushedAt: doc.pushedAt,
    access: { role: record?.role || 'read', canWrite, mode: canWrite ? 'read_write' : 'read_only' },
    index: {
      status: doc.indexingStatus,
      branch: doc.indexedBranch,
      commitSha: doc.lastIndexedCommitSha,
      indexedAt: doc.lastIndexedAt,
      files: doc.indexStats?.filesIndexed || 0,
      chunks: doc.indexStats?.chunks || 0,
      symbols: doc.indexStats?.symbols || 0,
    },
  };
}

export async function vectorCount(repositoryId) {
  try {
    return await countRepositoryVectors(repositoryId);
  } catch {
    return null;
  }
}
