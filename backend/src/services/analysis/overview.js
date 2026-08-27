import { CodeFile } from '../../models/CodeFile.js';
import { Repository } from '../../models/Repository.js';
import { detectStack, newManifest, parseManifestInto } from './manifest.js';
import { getFileContent } from '../github/contents.js';
import { logger } from '../../utils/logger.js';

const ENTRY_PATTERNS = [
  /(^|\/)(server|app|main|index)\.(js|jsx|mjs|cjs|ts|tsx)$/i,
  /(^|\/)main\.(py|go|rs|java|kt)$/i,
  /(^|\/)manage\.py$/i,
  /(^|\/)cmd\/[^/]+\/main\.go$/i,
];

/**
 * Deterministic repository facts, computed from data CodeWeave already stored:
 * ONE Mongo query plus the manifest captured during indexing. No GitHub calls,
 * so the overview page renders immediately.
 */
export async function computeRepositoryFacts({ repositoryId, octokit, owner, repo, ref }) {
  const [repository, files] = await Promise.all([
    Repository.findById(repositoryId).select('indexStats manifest').lean(),
    CodeFile.find({ repositoryId }).select('filePath language lines isTest routes symbolCount').lean(),
  ]);

  const languages = new Map();
  const directories = new Map();
  const routes = [];
  let totalLines = 0;
  let testFileCount = 0;

  for (const file of files) {
    const lang = languages.get(file.language) || { language: file.language, files: 0, lines: 0 };
    lang.files += 1;
    lang.lines += file.lines || 0;
    languages.set(file.language, lang);

    const top = file.filePath.includes('/') ? file.filePath.split('/')[0] : '(root)';
    const dir = directories.get(top) || { path: top, files: 0, lines: 0 };
    dir.files += 1;
    dir.lines += file.lines || 0;
    directories.set(top, dir);

    totalLines += file.lines || 0;
    if (file.isTest) testFileCount += 1;
    for (const route of file.routes || []) {
      routes.push({ method: route.method, path: route.path, handler: route.handler, filePath: file.filePath });
    }
  }

  // Manifests are captured while indexing; only fall back to a single GitHub read
  // for repositories indexed before that existed.
  let manifest = repository?.manifest;
  if ((!manifest || !manifest.found?.length) && octokit && owner && repo) {
    manifest = await backfillManifest({ repositoryId, octokit, owner, repo, ref });
  }
  const dependencies = manifest?.dependencies || [];
  const { frameworks, databases } = detectStack(dependencies);

  const entryPoints = files
    .filter((f) => ENTRY_PATTERNS.some((re) => re.test(f.filePath)))
    .map((f) => f.filePath)
    .sort((a, b) => a.split('/').length - b.split('/').length)
    .slice(0, 8);

  return {
    languages: [...languages.values()].sort((a, b) => b.lines - a.lines),
    directories: [...directories.values()].sort((a, b) => b.files - a.files).slice(0, 12),
    fileCount: files.length,
    testFileCount,
    totalLines,
    symbolCount: repository?.indexStats?.symbols ?? 0,
    edgeCount: repository?.indexStats?.edges ?? 0,
    routes: routes.slice(0, 60),
    routeCount: routes.length,
    frameworks,
    databases,
    dependencies: dependencies.slice(0, 60),
    manifests: manifest?.found || [],
    scripts: manifest?.scripts || {},
    projectName: manifest?.name || '',
    projectDescription: manifest?.description || '',
  };
}

/** One-off: read package.json for repositories indexed before manifest capture. */
async function backfillManifest({ repositoryId, octokit, owner, repo, ref }) {
  try {
    const file = await getFileContent(octokit, owner, repo, 'package.json', ref);
    if (!file?.content) return null;
    const manifest = parseManifestInto(newManifest(), 'package.json', file.content);
    await Repository.findByIdAndUpdate(repositoryId, { $set: { manifest } });
    logger.debug({ repositoryId: String(repositoryId) }, 'Backfilled manifest from package.json');
    return manifest;
  } catch {
    return null;
  }
}
