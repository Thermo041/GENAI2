import { describe, expect, it } from 'vitest';
import { classifyTreeEntry, detectLanguage, isTestPath, looksBinary } from '../src/utils/fileFilter.js';
import { selectFiles } from '../src/services/indexing/fileSelection.js';

describe('classifyTreeEntry', () => {
  const include = (path, size = 1000) => classifyTreeEntry({ path, size }, { maxFileSize: 180000 });

  it('includes real source files with a language', () => {
    expect(include('src/services/payment.js')).toMatchObject({ include: true, language: 'javascript' });
    expect(include('app/models/user.py')).toMatchObject({ include: true, language: 'python' });
    expect(include('cmd/server/main.go')).toMatchObject({ include: true, language: 'go' });
    expect(include('README.md')).toMatchObject({ include: true, language: 'markdown' });
  });

  it('excludes dependency and build directories', () => {
    expect(include('node_modules/react/index.js').include).toBe(false);
    expect(include('dist/bundle.js').include).toBe(false);
    expect(include('vendor/lib/thing.php').include).toBe(false);
    expect(include('coverage/lcov-report/index.html').include).toBe(false);
    expect(include('target/classes/Main.class').include).toBe(false);
  });

  it('excludes binaries, media and archives', () => {
    for (const path of ['logo.png', 'demo.mp4', 'archive.zip', 'app.exe', 'lib.so', 'model.onnx', 'font.woff2']) {
      expect(include(path).include, path).toBe(false);
    }
  });

  it('excludes lock files, minified and generated output', () => {
    expect(include('package-lock.json').reason).toBe('lock-file');
    expect(include('yarn.lock').reason).toBe('lock-file');
    expect(include('public/app.min.js').reason).toBe('generated');
    expect(include('types/index.d.ts').reason).toBe('generated');
    expect(include('bundle.js.map').include).toBe(false);
  });

  it('excludes files that are too large or empty', () => {
    expect(include('src/huge.js', 900000).reason).toBe('too-large');
    expect(include('src/empty.js', 0).reason).toBe('empty');
  });

  it('excludes dotfiles but keeps .env.example and .github workflows', () => {
    expect(include('.eslintrc.js').include).toBe(false);
    expect(include('.env').include).toBe(false);
    expect(include('.env.example').include).toBe(true);
    expect(include('.github/workflows/ci.yml').include).toBe(true);
  });
});

describe('detectLanguage', () => {
  it('maps extensions and well-known filenames', () => {
    expect(detectLanguage('a/b/c.jsx')).toBe('javascript');
    expect(detectLanguage('a/b/c.tsx')).toBe('typescript');
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('Makefile')).toBe('makefile');
    expect(detectLanguage('schema.sql')).toBe('sql');
    expect(detectLanguage('weird.unknownext')).toBe('text');
  });
});

describe('looksBinary', () => {
  it('detects NUL bytes and control-character soup', () => {
    expect(looksBinary('hello\0world')).toBe(true);
    expect(looksBinary(String.fromCharCode(1, 2, 3, 4, 5, 6, 7).repeat(50))).toBe(true);
    expect(looksBinary('function ok() { return 1; }\n')).toBe(false);
  });
});

describe('isTestPath', () => {
  it('recognises common test layouts', () => {
    expect(isTestPath('tests/user.test.js')).toBe(true);
    expect(isTestPath('src/__tests__/auth.js')).toBe(true);
    expect(isTestPath('src/user.spec.ts')).toBe(true);
    expect(isTestPath('internal/handler_test.go')).toBe(true);
    expect(isTestPath('src/services/user.js')).toBe(false);
  });
});

describe('selectFiles', () => {
  const entries = [
    { path: 'node_modules/x/index.js', size: 100 },
    { path: 'package-lock.json', size: 5000 },
    { path: 'src/controllers/auth.controller.js', size: 3000 },
    { path: 'src/services/auth.service.js', size: 2500 },
    { path: 'src/models/User.js', size: 1500 },
    { path: 'src/index.js', size: 500 },
    { path: 'docs/architecture.md', size: 8000 },
    { path: 'locales/en.json', size: 4000 },
    { path: 'tests/auth.test.js', size: 2000 },
    { path: 'logo.png', size: 9000 },
    { path: 'package.json', size: 900 },
  ];

  it('keeps source files and drops junk', () => {
    const result = selectFiles(entries, { maxFiles: 100, maxFileSize: 180000 });
    const paths = result.selected.map((f) => f.path);
    expect(paths).toContain('src/controllers/auth.controller.js');
    expect(paths).toContain('package.json');
    expect(paths).not.toContain('node_modules/x/index.js');
    expect(paths).not.toContain('logo.png');
    expect(paths).not.toContain('package-lock.json');
    expect(result.discovered).toBe(entries.length);
  });

  it('prioritises application source over docs and locales when capped', () => {
    const result = selectFiles(entries, { maxFiles: 4, maxFileSize: 180000 });
    const paths = result.selected.map((f) => f.path);
    expect(paths).toContain('src/controllers/auth.controller.js');
    expect(paths).toContain('src/services/auth.service.js');
    expect(paths).not.toContain('locales/en.json');
    expect(paths).not.toContain('docs/architecture.md');
    expect(result.truncated).toBe(true);
    expect(result.selected).toHaveLength(4);
  });

  it('reports truncation from a truncated GitHub tree', () => {
    const result = selectFiles(entries, { maxFiles: 100, truncated: true });
    expect(result.truncated).toBe(true);
  });
});
