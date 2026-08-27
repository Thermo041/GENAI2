import { CodeSymbol } from '../../models/CodeSymbol.js';
import { CodeEdge } from '../../models/CodeEdge.js';
import { CodeFile } from '../../models/CodeFile.js';
import { errors } from '../../utils/errors.js';

/**
 * STRUCTURAL impact analysis, computed from the AST-derived graph in MongoDB —
 * no LLM involved at this stage. Returns definitions, direct callers, a second
 * hop, importers, route exposure and test coverage, each with a severity that
 * comes from the graph, not from a guess.
 */
export async function analyzeImpactGraph({ repositoryId, symbolName, filePath }) {
  const name = String(symbolName || '').trim().replace(/\(\)$/, '');
  if (!name) throw errors.badRequest('A symbol name is required for impact analysis.');

  const definitions = await CodeSymbol.find({
    repositoryId,
    $or: [{ name }, { qualifiedName: name }],
    ...(filePath ? { filePath } : {}),
  })
    .select('filePath name qualifiedName kind className signature startLine endLine exported isTest doc calls loc')
    .limit(10)
    .lean();

  if (definitions.length === 0) {
    throw errors.notFound(
      `"${name}" was not found in the indexed symbols for this repository. Check the spelling, or re-index if the code changed.`,
    );
  }

  const definitionFiles = [...new Set(definitions.map((d) => d.filePath))];

  const [callEdges, importEdges, routeEdges] = await Promise.all([
    CodeEdge.find({ repositoryId, type: { $in: ['calls', 'tests'] }, toName: name })
      .select('type fromFile fromSymbol toFile toSymbol line confidence')
      .limit(400)
      .lean(),
    CodeEdge.find({ repositoryId, type: 'imports', toFile: { $in: definitionFiles } })
      .select('fromFile toFile line confidence')
      .limit(200)
      .lean(),
    CodeEdge.find({ repositoryId, type: 'routes', $or: [{ toName: name }, { toSymbol: name }] })
      .select('fromFile fromSymbol toSymbol line')
      .limit(50)
      .lean(),
  ]);

  const callerFiles = [...new Set(callEdges.map((e) => e.fromFile))];
  const fileMeta = await CodeFile.find({ repositoryId, filePath: { $in: [...callerFiles, ...definitionFiles] } })
    .select('filePath language isTest routes')
    .lean();
  const metaByPath = new Map(fileMeta.map((f) => [f.filePath, f]));

  // Second hop: who calls the direct callers?
  const callerSymbols = [...new Set(callEdges.map((e) => e.fromSymbol).filter((s) => s && s !== '<module>'))].slice(0, 40);
  const secondHop = callerSymbols.length
    ? await CodeEdge.find({ repositoryId, type: 'calls', toName: { $in: callerSymbols } })
        .select('fromFile fromSymbol toName line confidence')
        .limit(200)
        .lean()
    : [];

  const routesTouching = await routesForFiles(repositoryId, [...definitionFiles, ...callerFiles]);

  const impacts = new Map();
  const record = (filePath, severity, reason, detail) => {
    if (!filePath || definitionFiles.includes(filePath)) return;
    const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const existing = impacts.get(filePath);
    if (existing && rank[existing.severity] >= rank[severity]) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      if (detail) existing.details.push(detail);
      return;
    }
    impacts.set(filePath, {
      filePath,
      severity,
      isTest: Boolean(metaByPath.get(filePath)?.isTest),
      language: metaByPath.get(filePath)?.language || '',
      reasons: existing ? [...new Set([...existing.reasons, reason])] : [reason],
      details: existing ? [...existing.details, detail].filter(Boolean) : [detail].filter(Boolean),
    });
  };

  for (const edge of callEdges) {
    const isTest = Boolean(metaByPath.get(edge.fromFile)?.isTest) || edge.type === 'tests';
    const severity = isTest ? 'LOW' : edge.confidence >= 0.7 ? 'HIGH' : 'MEDIUM';
    record(
      edge.fromFile,
      severity,
      isTest ? `Tests ${name}` : `Calls ${name}()`,
      `${edge.fromSymbol || '<module>'} → ${name} at line ${edge.line}${edge.confidence < 0.7 ? ' (unresolved receiver)' : ''}`,
    );
  }

  for (const edge of importEdges) {
    record(edge.fromFile, 'MEDIUM', `Imports ${edge.toFile}`, `imports the module that defines ${name} (line ${edge.line})`);
  }

  for (const edge of secondHop) {
    record(edge.fromFile, 'MEDIUM', `Indirectly reaches ${name}`, `${edge.fromSymbol || '<module>'} → ${edge.toName} → ${name}`);
  }

  for (const route of routesTouching) {
    record(route.filePath, 'HIGH', 'Exposes an API route in the affected path', `${route.method} ${route.path} → ${route.handler}`);
  }

  const ordered = [...impacts.values()].sort((a, b) => {
    const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return rank[b.severity] - rank[a.severity] || b.details.length - a.details.length || a.filePath.localeCompare(b.filePath);
  });

  const directCallers = callEdges
    .filter((e) => e.type === 'calls')
    .map((e) => ({ filePath: e.fromFile, symbol: e.fromSymbol || '<module>', line: e.line, confidence: e.confidence }));

  return {
    symbol: name,
    definitions,
    impacts: ordered.slice(0, 40),
    directCallers,
    importers: importEdges.map((e) => ({ filePath: e.fromFile, line: e.line })),
    tests: callEdges.filter((e) => e.type === 'tests' || metaByPath.get(e.fromFile)?.isTest).map((e) => e.fromFile),
    routes: routesTouching,
    callPaths: buildCallPaths(name, callEdges, secondHop),
    counts: {
      definitions: definitions.length,
      directCallers: directCallers.length,
      importers: importEdges.length,
      secondHop: secondHop.length,
      tests: new Set(callEdges.filter((e) => metaByPath.get(e.fromFile)?.isTest).map((e) => e.fromFile)).size,
      routes: routesTouching.length,
      high: ordered.filter((i) => i.severity === 'HIGH').length,
      medium: ordered.filter((i) => i.severity === 'MEDIUM').length,
      low: ordered.filter((i) => i.severity === 'LOW').length,
    },
  };
}

async function routesForFiles(repositoryId, filePaths) {
  if (!filePaths.length) return [];
  const files = await CodeFile.find({ repositoryId, filePath: { $in: filePaths }, 'routes.0': { $exists: true } })
    .select('filePath routes')
    .limit(40)
    .lean();
  return files.flatMap((file) =>
    (file.routes || []).slice(0, 8).map((route) => ({
      filePath: file.filePath,
      method: route.method,
      path: route.path,
      handler: route.handler,
      line: route.line,
    })),
  );
}

/** Human-readable chains: caller -> target, plus one extra hop where known. */
function buildCallPaths(name, callEdges, secondHop) {
  const paths = [];
  for (const edge of callEdges.filter((e) => e.type === 'calls').slice(0, 12)) {
    const caller = edge.fromSymbol || '<module>';
    const upstream = secondHop.filter((s) => s.toName === caller).slice(0, 2);
    if (upstream.length) {
      for (const up of upstream) {
        paths.push(`${up.fromFile}:${up.fromSymbol || '<module>'} → ${edge.fromFile}:${caller} → ${name}`);
      }
    } else {
      paths.push(`${edge.fromFile}:${caller} → ${name}`);
    }
  }
  return [...new Set(paths)].slice(0, 14);
}

/** Symbol search used by the UI's symbol palette. */
export async function searchSymbols({ repositoryId, query, limit = 25 }) {
  const term = String(query || '').trim();
  if (term.length < 2) return [];
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return CodeSymbol.find({ repositoryId, name: { $regex: escaped, $options: 'i' } })
    .select('name qualifiedName kind filePath startLine endLine signature exported isTest')
    .sort({ exported: -1, loc: -1 })
    .limit(limit)
    .lean();
}
