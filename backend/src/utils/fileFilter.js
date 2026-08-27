import path from 'node:path';

/** Directories that never contain first-party source worth indexing. */
export const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.github/workflows/cache', 'dist', 'build', 'out', 'coverage', 'vendor',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '__pycache__', '.venv', 'venv', 'env',
  'target', 'bin', 'obj', 'Pods', '.gradle', '.idea', '.vscode', 'bower_components', 'jspm_packages',
  'site-packages', '.terraform', '.serverless', 'tmp', 'temp', 'logs', '.pytest_cache', '.mypy_cache',
  'storybook-static', 'public/assets', 'migrations/versions',
]);

/** Binary / generated extensions — never fetched. */
export const IGNORED_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg', '.tiff', '.avif',
  '.mp3', '.mp4', '.wav', '.mov', '.avi', '.mkv', '.webm', '.flac', '.ogg',
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.7z', '.rar', '.xz',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.class', '.jar', '.war', '.pyc', '.pyo',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.db', '.sqlite', '.sqlite3', '.mdb', '.parquet', '.pkl', '.onnx', '.pt', '.pth', '.h5', '.safetensors',
  '.map', '.min.js', '.min.css', '.lock', '.snap', '.wasm', '.psd', '.ai', '.sketch',
]);

/** Lock files: skipped for embeddings, but their presence is used for framework detection. */
export const LOCK_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'composer.lock',
  'Gemfile.lock', 'poetry.lock', 'Pipfile.lock', 'Cargo.lock', 'go.sum', 'pubspec.lock',
]);

const LANGUAGE_BY_EXT = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.py': 'python', '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.scala': 'scala',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
  '.cs': 'csharp', '.go': 'go', '.rs': 'rust', '.rb': 'ruby', '.php': 'php', '.swift': 'swift',
  '.dart': 'dart', '.ex': 'elixir', '.exs': 'elixir', '.erl': 'erlang', '.hs': 'haskell',
  '.lua': 'lua', '.pl': 'perl', '.r': 'r', '.sql': 'sql', '.sh': 'shell', '.bash': 'shell',
  '.zsh': 'shell', '.ps1': 'powershell', '.html': 'html', '.htm': 'html', '.vue': 'vue',
  '.svelte': 'svelte', '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
  '.json': 'json', '.jsonc': 'json', '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml',
  '.xml': 'xml', '.md': 'markdown', '.mdx': 'markdown', '.rst': 'restructuredtext',
  '.graphql': 'graphql', '.gql': 'graphql', '.proto': 'protobuf', '.tf': 'terraform',
  '.gradle': 'groovy', '.groovy': 'groovy', '.dockerfile': 'dockerfile', '.env': 'dotenv',
};

const FILENAME_LANGUAGE = {
  dockerfile: 'dockerfile', makefile: 'makefile', 'cmakelists.txt': 'cmake',
  'jenkinsfile': 'groovy', 'procfile': 'text', 'gemfile': 'ruby', 'rakefile': 'ruby',
  '.env.example': 'dotenv', '.env.sample': 'dotenv', '.env.template': 'dotenv',
};

export function detectLanguage(filePath) {
  const base = path.posix.basename(filePath).toLowerCase();
  if (FILENAME_LANGUAGE[base]) return FILENAME_LANGUAGE[base];
  const ext = path.posix.extname(base);
  return LANGUAGE_BY_EXT[ext] || 'text';
}

export const JS_LANGUAGES = new Set(['javascript', 'typescript', 'vue', 'svelte']);

export function isJsFamily(filePath) {
  return JS_LANGUAGES.has(detectLanguage(filePath)) && !/\.(vue|svelte)$/i.test(filePath);
}

/**
 * Decides whether a repository tree entry should be fetched + indexed.
 * Returns { include: boolean, reason?: string, language?: string }.
 */
export function classifyTreeEntry(entry, { maxFileSize = 180000 } = {}) {
  const filePath = entry.path;
  const base = path.posix.basename(filePath);
  const lower = filePath.toLowerCase();
  const segments = filePath.split('/');

  for (const segment of segments.slice(0, -1)) {
    if (IGNORED_DIRS.has(segment) || (segment.startsWith('.') && segment !== '.github')) {
      return { include: false, reason: `ignored-dir:${segment}` };
    }
  }
  if (LOCK_FILES.has(base)) return { include: false, reason: 'lock-file' };
  if (/\.min\.(js|css)$/i.test(lower) || /\.d\.ts$/i.test(lower) || /\.(map|snap)$/i.test(lower)) {
    return { include: false, reason: 'generated' };
  }
  const ext = path.posix.extname(lower);
  if (IGNORED_EXTS.has(ext)) return { include: false, reason: `binary:${ext}` };
  if (base.startsWith('.') && !['.env.example', '.eslintrc.json', '.babelrc'].includes(base)) {
    return { include: false, reason: 'dotfile' };
  }
  if (typeof entry.size === 'number' && entry.size > maxFileSize) {
    return { include: false, reason: 'too-large' };
  }
  if (typeof entry.size === 'number' && entry.size === 0) return { include: false, reason: 'empty' };

  const language = detectLanguage(filePath);
  if (language === 'text' && !/\.(txt|md)$/i.test(lower)) return { include: false, reason: 'unknown-language' };
  return { include: true, language };
}

/** Heuristic: does the byte content look like text we can safely embed? */
export function looksBinary(content) {
  if (typeof content !== 'string') return true;
  const sample = content.slice(0, 4000);
  if (sample.includes('\0')) return true;
  let control = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    if (code < 9 || (code > 13 && code < 32)) control += 1;
  }
  return control / Math.max(sample.length, 1) > 0.02;
}

export function isTestPath(filePath) {
  return /(^|\/)(tests?|__tests__|spec|e2e|cypress)\//i.test(filePath) ||
    /\.(test|spec)\.[a-z]+$/i.test(filePath) || /_test\.[a-z]+$/i.test(filePath);
}
