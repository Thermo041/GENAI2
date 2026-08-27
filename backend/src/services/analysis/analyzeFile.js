import path from 'node:path';
import { detectLanguage, isJsFamily } from '../../utils/fileFilter.js';
import { analyzeJsFile } from './jsAst.js';
import { analyzeGenericFile } from './genericSymbols.js';

/** Dispatches to the real AST parser for JS/TS, regex extraction otherwise. */
export function analyzeFile({ filePath, content, language }) {
  const lang = language || detectLanguage(filePath);
  if (isJsFamily(filePath)) {
    const result = analyzeJsFile(filePath, content);
    if (result.parseOk || result.symbols.length) return { ...result, language: lang };
    return { ...analyzeGenericFile(filePath, content, 'javascript'), language: lang, parseOk: false, parseError: result.parseError };
  }
  return { ...analyzeGenericFile(filePath, content, lang), language: lang };
}

const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.svelte'];
const INDEX_FILES = JS_EXTENSIONS.map((ext) => `index${ext}`);

/**
 * Resolves a module specifier to a path inside the repository, mirroring Node /
 * bundler resolution closely enough for dependency edges:
 *   ./x, ../x, extensionless, /index.*, and the common "@/..." src alias.
 * Returns '' for third-party modules.
 */
export function resolveImportPath(fromFile, raw, fileSet) {
  if (!raw || typeof raw !== 'string') return '';
  const fromDir = path.posix.dirname(fromFile);

  const candidates = [];
  if (raw.startsWith('.')) {
    candidates.push(path.posix.normalize(path.posix.join(fromDir, raw)));
  } else if (raw.startsWith('/')) {
    candidates.push(raw.replace(/^\/+/, ''));
  } else if (raw.startsWith('@/') || raw.startsWith('~/')) {
    const bare = raw.slice(2);
    candidates.push(`src/${bare}`, bare, `app/${bare}`, `lib/${bare}`);
  } else if (/^[a-z0-9-]+\//i.test(raw) && !raw.startsWith('@')) {
    // Could be a repo-internal absolute-ish import (e.g. "services/auth").
    candidates.push(raw, `src/${raw}`);
  } else {
    return '';
  }

  for (const candidate of candidates) {
    const cleaned = candidate.replace(/^\.\//, '').replace(/\/+$/, '');
    if (fileSet.has(cleaned)) return cleaned;
    for (const ext of JS_EXTENSIONS) {
      if (fileSet.has(`${cleaned}${ext}`)) return `${cleaned}${ext}`;
    }
    // Extensionless TS/JS rewrite: "./a.js" in an ESM+TS repo may be "./a.ts"
    const withoutExt = cleaned.replace(/\.(js|jsx|mjs|cjs)$/, '');
    for (const ext of JS_EXTENSIONS) {
      if (fileSet.has(`${withoutExt}${ext}`)) return `${withoutExt}${ext}`;
    }
    for (const indexFile of INDEX_FILES) {
      if (fileSet.has(`${cleaned}/${indexFile}`)) return `${cleaned}/${indexFile}`;
    }
  }
  return '';
}
