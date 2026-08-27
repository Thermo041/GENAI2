import { isTestPath } from '../../utils/fileFilter.js';
import { resolveImportPath } from './analyzeFile.js';

const NOISE_CALLS = new Set([
  'log', 'error', 'warn', 'info', 'debug', 'json', 'send', 'status', 'push', 'map', 'filter', 'forEach',
  'then', 'catch', 'finally', 'require', 'toString', 'keys', 'values', 'entries', 'stringify', 'parse',
  'test', 'expect', 'describe', 'it', 'beforeEach', 'afterEach', 'length', 'slice', 'split', 'join',
  'trim', 'includes', 'indexOf', 'replace', 'concat', 'set', 'get', 'has', 'add', 'delete', 'now',
  'useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'setTimeout', 'setInterval', 'String',
  'Number', 'Boolean', 'Array', 'Object', 'Promise', 'Error', 'Math', 'Date', 'JSON', 'console',
]);

/**
 * Turns per-file AST output into the persisted graph:
 *   CodeFile   — imports/exports/routes per file
 *   CodeSymbol — every function/class/method/route
 *   CodeEdge   — imports / defines / calls / tests / routes
 *
 * Call resolution is import-aware: a call to `processPayment` inside
 * orderService.js resolves to the symbol in the file orderService imports,
 * falling back to a repository-unique name match, and is otherwise recorded
 * unresolved with low confidence (never invented).
 */
export function buildGraph({ repositoryId, commitSha, files, extraFilePaths = [], extraSymbols = [] }) {
  const fileSet = new Set([...files.map((f) => f.filePath), ...extraFilePaths]);
  const symbolIndex = new Map(); // name -> [{ filePath, symbol }]
  const fileDocs = [];
  const symbolDocs = [];
  const edgeDocs = [];

  const addToIndex = (filePath, symbol) => {
    for (const key of new Set([symbol.name, symbol.qualifiedName])) {
      if (!key) continue;
      if (!symbolIndex.has(key)) symbolIndex.set(key, []);
      symbolIndex.get(key).push({ filePath, symbol });
    }
  };

  // Symbols already in the graph (incremental sync) participate in resolution.
  for (const existing of extraSymbols) addToIndex(existing.filePath, existing);
  for (const file of files) {
    for (const symbol of file.analysis.symbols) addToIndex(file.filePath, symbol);
  }

  for (const file of files) {
    const { filePath, language, analysis } = file;
    const isTest = isTestPath(filePath);

    const imports = analysis.imports.map((imp) => {
      const resolved = imp.isExternal ? '' : resolveImportPath(filePath, imp.raw, fileSet);
      return { ...imp, resolved, isExternal: imp.isExternal || !resolved };
    });

    fileDocs.push({
      repositoryId,
      commitSha,
      filePath,
      language,
      lines: file.lines,
      bytes: file.bytes,
      isTest,
      parseOk: analysis.parseOk !== false,
      imports,
      exports: analysis.exports || [],
      routes: analysis.routes || [],
      symbolCount: analysis.symbols.length,
      chunkCount: file.chunkCount || 0,
      contentSha: file.contentSha || '',
    });

    for (const imp of imports) {
      edgeDocs.push({
        repositoryId,
        commitSha,
        type: 'imports',
        fromFile: filePath,
        toFile: imp.resolved || '',
        toName: imp.raw,
        line: imp.line,
        external: imp.isExternal,
        confidence: imp.resolved ? 0.95 : 0.5,
      });
    }

    for (const symbol of analysis.symbols) {
      symbolDocs.push({
        repositoryId,
        commitSha,
        filePath,
        language,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName || symbol.name,
        kind: symbol.kind,
        className: symbol.className || '',
        signature: symbol.signature || '',
        params: symbol.params || [],
        exported: Boolean(symbol.exported),
        isAsync: Boolean(symbol.isAsync),
        isTest,
        doc: symbol.doc || '',
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        loc: symbol.loc || Math.max(1, symbol.endLine - symbol.startLine + 1),
        calls: (symbol.calls || []).filter((c) => !NOISE_CALLS.has(c)).slice(0, 40),
      });
      edgeDocs.push({
        repositoryId,
        commitSha,
        type: 'defines',
        fromFile: filePath,
        toFile: filePath,
        toSymbol: symbol.qualifiedName || symbol.name,
        toName: symbol.name,
        line: symbol.startLine,
        confidence: 1,
      });
    }

    const importedFiles = imports.filter((i) => i.resolved).map((i) => i.resolved);

    for (const call of analysis.calls || []) {
      if (!call.to || NOISE_CALLS.has(call.to)) continue;
      const resolution = resolveCall(call, { filePath, importedFiles, symbolIndex });
      if (!resolution) continue;
      edgeDocs.push({
        repositoryId,
        commitSha,
        type: isTest && resolution.toFile && resolution.toFile !== filePath ? 'tests' : 'calls',
        fromFile: filePath,
        fromSymbol: call.from || '<module>',
        toFile: resolution.toFile,
        toSymbol: resolution.toSymbol,
        toName: call.to,
        line: call.line,
        external: !resolution.toFile,
        confidence: resolution.confidence,
      });
    }

    for (const route of analysis.routes || []) {
      const handlerName = (route.handler || '').split(',')[0].trim();
      if (!handlerName) continue;
      const resolution = resolveCall({ to: handlerName.split('.').pop() }, { filePath, importedFiles, symbolIndex });
      edgeDocs.push({
        repositoryId,
        commitSha,
        type: 'routes',
        fromFile: filePath,
        fromSymbol: `${route.method} ${route.path}`,
        toFile: resolution?.toFile || '',
        toSymbol: resolution?.toSymbol || handlerName,
        toName: handlerName,
        line: route.line,
        confidence: resolution?.confidence ?? 0.4,
      });
    }
  }

  return { fileDocs, symbolDocs, edgeDocs };
}

function resolveCall(call, { filePath, importedFiles, symbolIndex }) {
  const candidates = symbolIndex.get(call.to);
  if (!candidates || candidates.length === 0) {
    return { toFile: '', toSymbol: '', confidence: 0.3 };
  }
  const local = candidates.find((c) => c.filePath === filePath);
  const imported = candidates.filter((c) => importedFiles.includes(c.filePath));

  if (imported.length === 1) {
    return { toFile: imported[0].filePath, toSymbol: imported[0].symbol.qualifiedName || imported[0].symbol.name, confidence: 0.95 };
  }
  if (imported.length > 1) {
    return { toFile: imported[0].filePath, toSymbol: imported[0].symbol.qualifiedName || imported[0].symbol.name, confidence: 0.6 };
  }
  if (local) {
    return { toFile: local.filePath, toSymbol: local.symbol.qualifiedName || local.symbol.name, confidence: 0.85 };
  }
  if (candidates.length === 1) {
    return { toFile: candidates[0].filePath, toSymbol: candidates[0].symbol.qualifiedName || candidates[0].symbol.name, confidence: 0.7 };
  }
  return { toFile: '', toSymbol: '', confidence: 0.35 };
}
