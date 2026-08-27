import { classifyTreeEntry, detectLanguage, isTestPath } from '../../utils/fileFilter.js';

const MANIFESTS = new Set([
  'package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'pom.xml', 'build.gradle',
  'build.gradle.kts', 'Cargo.toml', 'composer.json', 'Gemfile', 'pubspec.yaml', 'Dockerfile',
  'docker-compose.yml', 'docker-compose.yaml', 'README.md', 'readme.md', 'vite.config.js',
  'next.config.js', 'nest-cli.json', 'tsconfig.json', 'schema.prisma', 'serverless.yml',
]);

const HIGH_VALUE_DIRS = /(^|\/)(src|app|lib|server|backend|api|controllers?|services?|models?|routes?|handlers?|pkg|internal|core|domain|components?|hooks?|store|db|database|repositories?|usecases?|middleware)(\/|$)/i;
const ENTRY_NAMES = /(^|\/)(index|main|app|server|program|startup|bootstrap|cli|__init__)\.[a-z]+$/i;

/**
 * Scores a file for indexing priority so that when a repository exceeds
 * MAX_FILES we keep the code that actually explains the system, not fixtures
 * and translations.
 */
function score(entry) {
  const path = entry.path;
  const base = path.split('/').pop();
  const language = detectLanguage(path);
  let value = 0;

  if (MANIFESTS.has(base)) value += 55;
  if (ENTRY_NAMES.test(path)) value += 45;
  if (HIGH_VALUE_DIRS.test(path)) value += 35;
  if (['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'ruby', 'php', 'csharp', 'cpp', 'c', 'kotlin', 'swift'].includes(language)) value += 70;
  else if (['vue', 'svelte', 'html', 'sql', 'graphql'].includes(language)) value += 40;
  else if (language === 'markdown') value += 6;
  else if (['json', 'yaml', 'toml', 'css', 'scss'].includes(language)) value += 3;

  if (isTestPath(path)) value -= 12;
  if (/(^|\/)(docs?|examples?|samples?|fixtures?|mocks?|__mocks__|locales?|i18n|translations?|assets?|public|static|dist)(\/)/i.test(path)) value -= 30;
  if (/(changelog|license|contributing|code_of_conduct)/i.test(base)) value -= 25;

  value -= Math.min(20, path.split('/').length * 2); // prefer shallower files
  if (entry.size > 60000) value -= 15;
  return value;
}

/**
 * Turns a GitHub tree into the concrete work list for indexing.
 * Returns { selected, skipped, discovered, sourceCount, truncated }.
 */
export function selectFiles(entries, { maxFiles = 500, maxFileSize = 180000, truncated = false } = {}) {
  const eligible = [];
  const skipped = [];

  for (const entry of entries) {
    const verdict = classifyTreeEntry(entry, { maxFileSize });
    if (!verdict.include) {
      skipped.push({ path: entry.path, reason: verdict.reason });
      continue;
    }
    eligible.push({ ...entry, language: verdict.language, score: score(entry) });
  }

  eligible.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const selected = eligible.slice(0, maxFiles);
  const dropped = eligible.slice(maxFiles);

  return {
    discovered: entries.length,
    sourceCount: eligible.length,
    selected: selected.sort((a, b) => a.path.localeCompare(b.path)),
    skipped: [...skipped, ...dropped.map((e) => ({ path: e.path, reason: 'over-max-files' }))],
    truncated: truncated || dropped.length > 0,
  };
}
