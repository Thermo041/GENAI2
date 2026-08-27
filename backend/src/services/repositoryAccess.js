import { Repository } from '../models/Repository.js';
import { errors } from '../utils/errors.js';
import { assertOwnerRepo } from '../utils/repoIdentity.js';
import { octokitForRequest } from './github/client.js';
import { getRepository, getLanguages } from './github/repositories.js';

/**
 * Single entry point for "can this user do X to this repository?".
 *
 * Always asks GitHub for fresh metadata + permissions, then mirrors them into
 * MongoDB for dashboard rendering. The DB copy is a cache for UI only; every
 * authorisation decision below uses the live GitHub response.
 */
export async function resolveRepository(req, ownerInput, repoInput, { withLanguages = false } = {}) {
  const { owner, repo } = assertOwnerRepo(ownerInput, repoInput);
  const octokit = await octokitForRequest(req);
  const meta = await getRepository(octokit, owner, repo, { authenticated: Boolean(req.user) });

  if (meta.isPrivate && !req.user) throw errors.unauthorized('Sign in with GitHub to open private repositories.');

  const languages = withLanguages ? await getLanguages(octokit, owner, repo) : null;
  const doc = await upsertRepository(meta, req.user?._id, languages);

  return { octokit, meta, doc, permissions: meta.permissions };
}

export async function upsertRepository(meta, userId, languages) {
  const update = {
    githubRepositoryId: meta.githubRepositoryId,
    owner: meta.owner,
    name: meta.name,
    fullName: meta.fullName,
    url: meta.url,
    description: meta.description,
    visibility: meta.visibility,
    isFork: meta.isFork,
    parentFullName: meta.parentFullName,
    defaultBranch: meta.defaultBranch,
    primaryLanguage: meta.primaryLanguage,
    stars: meta.stars,
    sizeKb: meta.sizeKb,
    topics: meta.topics,
    pushedAt: meta.pushedAt,
  };
  if (languages && Object.keys(languages).length) update.languages = languages;

  const doc = await Repository.findOneAndUpdate(
    { owner: meta.owner, name: meta.name },
    { $set: update, $setOnInsert: { indexingStatus: 'not_indexed' } },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  );

  if (userId) {
    const record = {
      userId,
      permissions: {
        admin: meta.permissions.admin,
        maintain: meta.permissions.maintain,
        push: meta.permissions.push,
        triage: meta.permissions.triage,
        pull: meta.permissions.pull,
      },
      role: meta.permissions.role,
      lastCheckedAt: new Date(),
    };
    const existing = doc.accessRecords.find((r) => r.userId.toString() === userId.toString());
    if (existing) {
      existing.permissions = record.permissions;
      existing.role = record.role;
      existing.lastCheckedAt = record.lastCheckedAt;
    } else {
      doc.accessRecords.push(record);
    }
    await doc.save();
  }
  return doc;
}

/**
 * Server-side authorisation gate for every write path. Hiding buttons in React
 * is cosmetic; this is the check that actually protects the repository.
 */
export function assertWriteAccess(meta) {
  if (meta.isArchived) throw errors.forbidden('This repository is archived on GitHub and cannot be modified.');
  if (!meta.permissions.canWrite) {
    throw errors.noWriteAccess(
      "You don't have write access to this repository. Use \"Fork & Modify with AI\" instead — CodeWeave will open the pull request from your own fork.",
    );
  }
  return true;
}

export function summarizeAccess(meta) {
  return {
    role: meta.permissions.role,
    canWrite: meta.permissions.canWrite,
    canFork: !meta.isPrivate || meta.permissions.canWrite,
    mode: meta.permissions.canWrite ? 'read_write' : 'read_only',
    reason: meta.permissions.canWrite
      ? 'GitHub reports push access for your account.'
      : 'GitHub reports read-only access for your account.',
  };
}
