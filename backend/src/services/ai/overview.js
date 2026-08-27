import { Repository } from '../../models/Repository.js';
import { computeRepositoryFacts } from '../analysis/overview.js';
import { retrieveContext } from './retrieval.js';
import { invokeStructured } from './groqService.js';
import { overviewSchema } from './schemas.js';
import { OVERVIEW_SYSTEM_PROMPT, renderChunk, wrapRepositoryContext } from './prompts.js';
import { tokenBudget } from './budget.js';
import { logger } from '../../utils/logger.js';

/**
 * The overview is deliberately two-phase:
 *
 *   loadOverviewFacts()        — deterministic, no LLM, always fast
 *   generateOverviewNarrative()— the Groq summary, cached per indexed commit
 *
 * Splitting them means the page renders real numbers immediately instead of
 * waiting on (or hanging behind) an inference call.
 */
export async function loadOverviewFacts({ repositoryDoc, octokit, meta }) {
  const commitSha = repositoryDoc.lastIndexedCommitSha;
  const facts = await computeRepositoryFacts({
    repositoryId: repositoryDoc._id,
    octokit,
    owner: meta.owner,
    repo: meta.name,
    ref: commitSha || meta.defaultBranch,
  });

  const cached = repositoryDoc.overview;
  const fresh = Boolean(cached?.summary) && cached.commitSha === commitSha;
  return {
    facts,
    narrative: cached?.summary ? shapeNarrative(cached) : null,
    cached: fresh,
    narrativeStatus: fresh ? 'ready' : cached?.summary ? 'stale' : 'missing',
  };
}

export async function generateOverviewNarrative({ repositoryDoc, octokit, meta, facts, refresh = false }) {
  const commitSha = repositoryDoc.lastIndexedCommitSha;
  const cached = repositoryDoc.overview;
  if (!refresh && cached?.summary && cached.commitSha === commitSha) {
    return { narrative: shapeNarrative(cached), cached: true };
  }

  const resolvedFacts =
    facts ||
    (await computeRepositoryFacts({
      repositoryId: repositoryDoc._id,
      octokit,
      owner: meta.owner,
      repo: meta.name,
      ref: commitSha || meta.defaultBranch,
    }));

  const budget = tokenBudget({ outputShare: 0.4 });
  const semantic = await retrieveContext({
    repositoryId: repositoryDoc._id,
    question: 'project entry point, application setup, main modules, request flow, data models',
    limit: 6,
    maxChars: Math.round(budget.inputChars * 0.4),
    includeGraph: false,
  });

  const context = wrapRepositoryContext([
    `REPOSITORY: ${meta.fullName}${meta.description ? ` — ${meta.description}` : ''}`,
    `GITHUB METADATA: visibility=${meta.visibility}, primary language=${meta.primaryLanguage || 'unknown'}, stars=${meta.stars}, default branch=${meta.defaultBranch}`,
    `INDEXED FACTS: ${resolvedFacts.fileCount} files, ${resolvedFacts.totalLines} lines, ${resolvedFacts.symbolCount} symbols, ${resolvedFacts.edgeCount} graph edges, ${resolvedFacts.testFileCount} test files`,
    `LANGUAGES: ${resolvedFacts.languages.map((l) => `${l.language} (${l.files} files, ${l.lines} lines)`).join(', ') || 'unknown'}`,
    `TOP-LEVEL DIRECTORIES: ${resolvedFacts.directories.map((d) => `${d.path} (${d.files})`).join(', ') || 'none'}`,
    `MANIFESTS FOUND: ${resolvedFacts.manifests.join(', ') || 'none'}`,
    `DETECTED FRAMEWORKS: ${resolvedFacts.frameworks.join(', ') || 'none detected'}`,
    `DETECTED DATA STORES: ${resolvedFacts.databases.join(', ') || 'none detected'}`,
    `ENTRY POINT CANDIDATES: ${resolvedFacts.entryPoints?.join(', ') || resolvedFacts.manifests.join(', ') || 'unknown'}`,
    resolvedFacts.routes.length
      ? `DETECTED HTTP ROUTES (${resolvedFacts.routeCount}):\n${resolvedFacts.routes.slice(0, 20).map((r) => `- ${r.method} ${r.path} -> ${r.handler} (${r.filePath})`).join('\n')}`
      : 'DETECTED HTTP ROUTES: none',
    resolvedFacts.scripts && Object.keys(resolvedFacts.scripts).length
      ? `NPM SCRIPTS: ${Object.entries(resolvedFacts.scripts).slice(0, 8).map(([k, v]) => `${k}="${v}"`).join(', ')}`
      : null,
    semantic.chunks.length ? `REPRESENTATIVE CODE:\n${semantic.chunks.slice(0, 5).map(renderChunk).join('\n\n')}` : null,
  ]);

  const { data, model } = await invokeStructured({
    system: OVERVIEW_SYSTEM_PROMPT,
    user: [
      context,
      'Describe this repository for a developer who has never seen it.',
      'Return JSON: { "summary": string, "architecture": string, "entryPoints": string[], "importantDirectories": [{"path": string, "purpose": string}], "frameworks": string[], "databases": string[] }',
      'Only list frameworks/databases that appear in the evidence above.',
    ].join('\n\n'),
    schema: overviewSchema,
    temperature: 0.2,
    maxTokens: Math.min(2000, budget.outputTokens),
    maxWaitMs: 60_000,
  });

  const overview = {
    generatedAt: new Date(),
    commitSha,
    summary: data.summary,
    architecture: data.architecture,
    entryPoints: data.entryPoints.length ? data.entryPoints : resolvedFacts.entryPoints || [],
    importantDirectories: data.importantDirectories,
    frameworks: [...new Set([...resolvedFacts.frameworks, ...data.frameworks])],
    databases: [...new Set([...resolvedFacts.databases, ...data.databases])],
    apiSurface: resolvedFacts.routes.slice(0, 40),
    dependencies: resolvedFacts.dependencies,
  };

  await Repository.findByIdAndUpdate(repositoryDoc._id, { $set: { overview } });
  logger.info({ repo: meta.fullName, model }, 'Repository overview generated');

  return { narrative: shapeNarrative(overview), cached: false, facts: resolvedFacts };
}

function shapeNarrative(overview) {
  return {
    generatedAt: overview.generatedAt,
    commitSha: overview.commitSha,
    summary: overview.summary,
    architecture: overview.architecture,
    entryPoints: overview.entryPoints || [],
    importantDirectories: overview.importantDirectories || [],
    frameworks: overview.frameworks || [],
    databases: overview.databases || [],
    apiSurface: overview.apiSurface || [],
    dependencies: overview.dependencies || [],
  };
}
