/**
 * Manifest parsing shared by the indexer (which already has the file content in
 * memory) and the overview facts. Keeping it here means dependency detection
 * never needs an extra GitHub round trip at read time.
 */
export const MANIFEST_FILES = new Set([
  'package.json',
  'requirements.txt',
  'go.mod',
  'pom.xml',
  'Cargo.toml',
  'pyproject.toml',
  'composer.json',
  'Gemfile',
]);

export function isManifest(filePath) {
  return MANIFEST_FILES.has(filePath.split('/').pop());
}

const emptyManifest = () => ({ found: [], dependencies: [], scripts: {}, name: '', description: '' });

/** Merges one manifest file into an accumulator. Never throws on bad JSON. */
export function parseManifestInto(accumulator, filePath, content) {
  const name = filePath.split('/').pop();
  if (!MANIFEST_FILES.has(name) || !content) return accumulator;
  const result = accumulator || emptyManifest();
  if (!result.found.includes(name)) result.found.push(name);

  try {
    if (name === 'package.json') {
      const pkg = JSON.parse(content);
      result.dependencies.push(...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {}));
      result.scripts = { ...result.scripts, ...(pkg.scripts || {}) };
      result.name = result.name || pkg.name || '';
      result.description = result.description || pkg.description || '';
    } else if (name === 'requirements.txt') {
      result.dependencies.push(
        ...content
          .split('\n')
          .map((line) => line.split(/[=<>~![\s]/)[0].trim())
          .filter((line) => line && !line.startsWith('#')),
      );
    } else if (name === 'go.mod') {
      result.dependencies.push(...(content.match(/^\s+([\w./-]+)\s+v/gm) || []).map((l) => l.trim().split(/\s+/)[0]));
    } else if (name === 'pom.xml') {
      result.dependencies.push(...(content.match(/<artifactId>([^<]+)<\/artifactId>/g) || []).map((m) => m.replace(/<\/?artifactId>/g, '')));
    } else if (name === 'Cargo.toml' || name === 'pyproject.toml') {
      result.dependencies.push(...(content.match(/^([a-zA-Z0-9_-]+)\s*=/gm) || []).map((m) => m.split('=')[0].trim()));
    } else if (name === 'composer.json') {
      const composer = JSON.parse(content);
      result.dependencies.push(...Object.keys(composer.require || {}));
    } else if (name === 'Gemfile') {
      result.dependencies.push(...(content.match(/^\s*gem\s+['"]([^'"]+)['"]/gm) || []).map((m) => m.replace(/^\s*gem\s+['"]/, '').replace(/['"]$/, '')));
    }
  } catch {
    // A malformed manifest is not worth failing an index over.
  }

  result.dependencies = [...new Set(result.dependencies.filter(Boolean))].slice(0, 200);
  return result;
}

export function newManifest() {
  return emptyManifest();
}

const FRAMEWORK_SIGNS = [
  [/^express$/, 'Express'], [/^koa$/, 'Koa'], [/^fastify$/, 'Fastify'], [/^@nestjs\//, 'NestJS'],
  [/^next$/, 'Next.js'], [/^react$/, 'React'], [/^react-native$/, 'React Native'], [/^vue$/, 'Vue'],
  [/^svelte$/, 'Svelte'], [/^@angular\/core$/, 'Angular'], [/^vite$/, 'Vite'], [/^webpack$/, 'Webpack'],
  [/^tailwindcss$/, 'Tailwind CSS'], [/^socket\.io$/, 'Socket.IO'], [/^graphql$/, 'GraphQL'],
  [/^@apollo\/server$/, 'Apollo Server'], [/^jest$/, 'Jest'], [/^vitest$/, 'Vitest'],
  [/^mocha$/, 'Mocha'], [/^cypress$/, 'Cypress'], [/^playwright/, 'Playwright'],
  [/^passport$/, 'Passport'], [/^jsonwebtoken$/, 'JWT auth'], [/^langchain|^@langchain\//, 'LangChain'],
  [/^flask$/i, 'Flask'], [/^django$/i, 'Django'], [/^fastapi$/i, 'FastAPI'],
  [/^spring-boot|spring-web/i, 'Spring Boot'], [/^gin-gonic\/gin/, 'Gin'], [/^actix-web/, 'Actix'],
  [/^rails$/i, 'Ruby on Rails'], [/^laravel\//i, 'Laravel'], [/^expo$/, 'Expo'],
];

const DB_SIGNS = [
  [/^mongoose$|^mongodb$/, 'MongoDB'], [/^pg$|^postgres/, 'PostgreSQL'], [/^mysql2?$/, 'MySQL'],
  [/^sqlite3?$|^better-sqlite3$/, 'SQLite'], [/^redis$|^ioredis$/, 'Redis'], [/^@prisma\/client$/, 'Prisma'],
  [/^sequelize$/, 'Sequelize'], [/^typeorm$/, 'TypeORM'], [/^knex$/, 'Knex'],
  [/^@qdrant\//, 'Qdrant'], [/^pinecone/, 'Pinecone'], [/^chromadb$/, 'Chroma'],
  [/^elasticsearch|^@elastic\//, 'Elasticsearch'], [/^psycopg2/i, 'PostgreSQL'], [/^sqlalchemy/i, 'SQLAlchemy'],
  [/^@supabase\//, 'Supabase'], [/^firebase$|^firebase-admin$/, 'Firebase'],
];

export function detectStack(dependencies = []) {
  const match = (signs) => [...new Set(signs.filter(([re]) => dependencies.some((d) => re.test(d))).map(([, name]) => name))];
  return { frameworks: match(FRAMEWORK_SIGNS), databases: match(DB_SIGNS) };
}
