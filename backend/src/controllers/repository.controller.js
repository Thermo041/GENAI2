import { z } from 'zod';
import { asyncHandler, ok } from '../utils/http.js';
import { errors } from '../utils/errors.js';
import { parseRepoInput, assertSafeRepoPath, isSafeBranchName } from '../utils/repoIdentity.js';
import { Repository } from '../models/Repository.js';
import { CodeFile } from '../models/CodeFile.js';
import { CodeSymbol } from '../models/CodeSymbol.js';
import { CodeEdge } from '../models/CodeEdge.js';
import { resolveRepository } from '../services/repositoryAccess.js';
import { buildRepositoryView, toRepositoryCard, vectorCount } from '../services/repositoryView.js';
import { listBranches, listUserRepositories, getBranchHead } from '../services/github/repositories.js';
import { getTree, getFileContent, listCommits } from '../services/github/contents.js';
import { octokitForUser } from '../services/github/client.js';
import { searchSymbols } from '../services/analysis/impactGraph.js';
import { generateOverviewNarrative, loadOverviewFacts } from '../services/ai/overview.js';

export const analyzeSchema = z.object({ url: z.string().min(3).max(400), branch: z.string().max(240).optional() });

/** POST /api/repositories/analyze — accepts a URL or owner/repo. */
export const analyzeRepository = asyncHandler(async (req, res) => {
  const parsed = parseRepoInput(req.body.url);
  const { octokit, meta, doc } = await resolveRepository(req, parsed.owner, parsed.repo, { withLanguages: true });

  const requestedBranch = req.body.branch || parsed.branch;
  if (requestedBranch && !isSafeBranchName(requestedBranch)) throw errors.badRequest('Invalid branch name.');
  if (requestedBranch && !doc.indexedBranch) {
    doc.indexedBranch = requestedBranch;
    await doc.save();
  }

  const view = await buildRepositoryView({
    meta,
    doc,
    octokit,
    userId: req.user?._id,
    userHasInstallation: (req.user?.installationIds?.length ?? 0) > 0,
  });
  return ok(res, { repository: view });
});

/** GET /api/repositories — repositories this user has analysed before. */
export const listAnalyzedRepositories = asyncHandler(async (req, res) => {
  const docs = await Repository.find({ 'accessRecords.userId': req.user._id })
    .sort({ updatedAt: -1 })
    .limit(60)
    .lean();
  return ok(res, { repositories: docs.map((doc) => toRepositoryCard(doc, req.user._id)) });
});

/** GET /api/github/repositories — live list from GitHub. */
export const listGithubRepositories = asyncHandler(async (req, res) => {
  const octokit = await octokitForUser(req.user._id);
  const repos = await listUserRepositories(octokit, { perPage: 100, maxPages: 3 });
  const known = await Repository.find({ fullName: { $in: repos.map((r) => r.fullName) } })
    .select('fullName indexingStatus lastIndexedCommitSha lastIndexedAt indexStats indexedBranch')
    .lean();
  const byName = new Map(known.map((k) => [k.fullName, k]));

  return ok(res, {
    repositories: repos.map((repo) => ({
      ...repo,
      access: { role: repo.permissions.role, canWrite: repo.permissions.canWrite, mode: repo.permissions.canWrite ? 'read_write' : 'read_only' },
      index: byName.get(repo.fullName)
        ? {
            status: byName.get(repo.fullName).indexingStatus,
            branch: byName.get(repo.fullName).indexedBranch,
            commitSha: byName.get(repo.fullName).lastIndexedCommitSha,
            indexedAt: byName.get(repo.fullName).lastIndexedAt,
            files: byName.get(repo.fullName).indexStats?.filesIndexed || 0,
          }
        : { status: 'not_indexed' },
    })),
  });
});

export const getRepositoryDetails = asyncHandler(async (req, res) => {
  const { octokit, meta, doc } = await resolveRepository(req, req.params.owner, req.params.repo, { withLanguages: true });
  const view = await buildRepositoryView({
    meta,
    doc,
    octokit,
    userId: req.user?._id,
    userHasInstallation: (req.user?.installationIds?.length ?? 0) > 0,
  });
  view.index.vectors = await vectorCount(doc._id);
  return ok(res, { repository: view });
});

export const getBranches = asyncHandler(async (req, res) => {
  const { octokit, meta } = await resolveRepository(req, req.params.owner, req.params.repo);
  const branches = await listBranches(octokit, meta.owner, meta.name);
  return ok(res, { branches, defaultBranch: meta.defaultBranch });
});

export const getRepositoryTree = asyncHandler(async (req, res) => {
  const { octokit, meta, doc } = await resolveRepository(req, req.params.owner, req.params.repo);
  const branch = req.query.branch && isSafeBranchName(req.query.branch) ? req.query.branch : doc.indexedBranch || meta.defaultBranch;
  const head = await getBranchHead(octokit, meta.owner, meta.name, branch);
  const tree = await getTree(octokit, meta.owner, meta.name, head.sha);

  const indexed = await CodeFile.find({ repositoryId: doc._id }).select('filePath symbolCount chunkCount').lean();
  const indexedMap = new Map(indexed.map((f) => [f.filePath, f]));

  return ok(res, {
    branch,
    commitSha: head.sha,
    truncated: tree.truncated,
    directories: tree.directories,
    files: tree.entries.map((entry) => ({
      path: entry.path,
      size: entry.size,
      sha: entry.sha,
      indexed: indexedMap.has(entry.path),
      symbols: indexedMap.get(entry.path)?.symbolCount || 0,
    })),
  });
});

export const getFile = asyncHandler(async (req, res) => {
  const { octokit, meta, doc } = await resolveRepository(req, req.params.owner, req.params.repo);
  const path = assertSafeRepoPath(req.query.path);
  const ref = req.query.ref && isSafeBranchName(req.query.ref) ? req.query.ref : doc.indexedBranch || meta.defaultBranch;
  const file = await getFileContent(octokit, meta.owner, meta.name, path, ref);
  const symbols = await CodeSymbol.find({ repositoryId: doc._id, filePath: path })
    .select('name kind startLine endLine signature exported')
    .sort({ startLine: 1 })
    .limit(200)
    .lean();
  return ok(res, { file: { ...file, ref }, symbols });
});

export const getCommits = asyncHandler(async (req, res) => {
  const { octokit, meta, doc } = await resolveRepository(req, req.params.owner, req.params.repo);
  const branch = req.query.branch && isSafeBranchName(req.query.branch) ? req.query.branch : doc.indexedBranch || meta.defaultBranch;
  const commits = await listCommits(octokit, meta.owner, meta.name, { sha: branch, perPage: 20 });
  return ok(res, { commits, branch });
});

export const getSymbols = asyncHandler(async (req, res) => {
  const { doc } = await resolveRepository(req, req.params.owner, req.params.repo);
  const symbols = await searchSymbols({ repositoryId: doc._id, query: req.query.q || '', limit: 30 });
  return ok(res, { symbols });
});

/**
 * GET — deterministic facts plus any cached narrative. Never calls the LLM, so
 * the page always renders immediately.
 */
export const getOverview = asyncHandler(async (req, res) => {
  const { octokit, meta, doc } = await resolveRepository(req, req.params.owner, req.params.repo, { withLanguages: true });
  if (doc.indexingStatus === 'not_indexed' || doc.indexingStatus === 'queued') {
    throw errors.notIndexed('Index this repository first to generate an overview.');
  }
  const result = await loadOverviewFacts({ repositoryDoc: doc, octokit, meta });
  return ok(res, { facts: result.facts, overview: result.narrative, cached: result.cached, narrativeStatus: result.narrativeStatus });
});

/** POST — generates (or refreshes) the AI narrative. Rate limited separately. */
export const createOverviewNarrative = asyncHandler(async (req, res) => {
  const { octokit, meta, doc } = await resolveRepository(req, req.params.owner, req.params.repo, { withLanguages: true });
  if (!['indexed', 'partial'].includes(doc.indexingStatus)) {
    throw errors.notIndexed('Index this repository first to generate an overview.');
  }
  const { narrative, cached } = await generateOverviewNarrative({
    repositoryDoc: doc,
    octokit,
    meta,
    refresh: req.body?.refresh === true,
  });
  return ok(res, { overview: narrative, cached, narrativeStatus: 'ready' });
});

/**
 * GET /api/repositories/:owner/:repo/graph — directory-level dependency graph
 * for the architecture view, aggregated from real import edges.
 */
export const getArchitectureGraph = asyncHandler(async (req, res) => {
  const { doc } = await resolveRepository(req, req.params.owner, req.params.repo);
  const [files, edges] = await Promise.all([
    CodeFile.find({ repositoryId: doc._id }).select('filePath language lines isTest routes symbolCount').lean(),
    CodeEdge.find({ repositoryId: doc._id, type: 'imports', external: false, toFile: { $ne: '' } })
      .select('fromFile toFile')
      .lean(),
  ]);

  const groupOf = (filePath) => {
    const parts = filePath.split('/');
    if (parts.length === 1) return '(root)';
    return parts.slice(0, Math.min(2, parts.length - 1)).join('/');
  };

  const nodes = new Map();
  for (const file of files) {
    const key = groupOf(file.filePath);
    if (!nodes.has(key)) nodes.set(key, { id: key, files: 0, lines: 0, symbols: 0, routes: 0, languages: {} });
    const node = nodes.get(key);
    node.files += 1;
    node.lines += file.lines || 0;
    node.symbols += file.symbolCount || 0;
    node.routes += (file.routes || []).length;
    node.languages[file.language] = (node.languages[file.language] || 0) + 1;
  }

  const links = new Map();
  for (const edge of edges) {
    const from = groupOf(edge.fromFile);
    const to = groupOf(edge.toFile);
    if (from === to) continue;
    const key = `${from}=>${to}`;
    links.set(key, { source: from, target: to, weight: (links.get(key)?.weight || 0) + 1 });
  }

  return ok(res, {
    nodes: [...nodes.values()].sort((a, b) => b.files - a.files).slice(0, 40),
    links: [...links.values()].sort((a, b) => b.weight - a.weight).slice(0, 120),
    fileCount: files.length,
    edgeCount: edges.length,
  });
});
