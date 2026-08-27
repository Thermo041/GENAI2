import { analyzeImpactGraph } from '../analysis/impactGraph.js';
import { retrieveContext } from './retrieval.js';
import { invokeText } from './groqService.js';
import { IMPACT_SYSTEM_PROMPT, renderChunk, wrapRepositoryContext } from './prompts.js';
import { tokenBudget } from './budget.js';
import { logger } from '../../utils/logger.js';

/**
 * Impact analysis = STRUCTURE + SEMANTICS + EXPLANATION.
 *
 *   1. AST graph (Mongo)  -> who really calls/imports/tests/routes this symbol
 *   2. Qdrant             -> semantically related code the graph cannot see
 *                            (sibling workflows, duplicated logic)
 *   3. Groq               -> explanation grounded in 1 and 2
 *
 * The severity list is computed from the graph, so it stays correct even if the
 * model's prose is cautious.
 */
export async function analyzeImpact({ repositoryDoc, symbolName, filePath, explain = true }) {
  const repositoryId = repositoryDoc._id;
  const graph = await analyzeImpactGraph({ repositoryId, symbolName, filePath });

  const definition = graph.definitions[0];
  const semanticQuery = [
    symbolName,
    definition?.signature || '',
    definition?.doc || '',
    'related logic and workflows that depend on this behaviour',
  ]
    .filter(Boolean)
    .join(' ');

  const budget = tokenBudget({ outputShare: 0.3 });
  const semantic = await retrieveContext({
    repositoryId,
    question: semanticQuery,
    limit: 8,
    maxChars: Math.round(budget.inputChars * 0.35),
    includeGraph: false,
  });

  const semanticOnly = semantic.chunks.filter(
    (chunk) => !graph.impacts.some((i) => i.filePath === chunk.filePath) && chunk.filePath !== definition?.filePath,
  );

  for (const chunk of semanticOnly.slice(0, 6)) {
    if (graph.impacts.length >= 40) break;
    graph.impacts.push({
      filePath: chunk.filePath,
      severity: 'LOW',
      isTest: Boolean(chunk.isTest),
      language: chunk.language,
      reasons: ['Semantically related code'],
      details: [`similar logic in ${chunk.symbolName === '<module>' ? 'module scope' : chunk.symbolName} (similarity ${(chunk.score ?? 0).toFixed(2)})`],
    });
  }

  let explanation = '';
  let usage = null;
  let model = '';

  if (explain) {
    const context = wrapRepositoryContext([
      `TARGET SYMBOL: ${symbolName}`,
      definition
        ? `DEFINITION: ${definition.filePath}:${definition.startLine}-${definition.endLine} — ${definition.signature || definition.kind}${definition.doc ? `\ndoc: ${definition.doc}` : ''}`
        : null,
      graph.callPaths.length ? `STRUCTURAL CALL PATHS (AST):\n${graph.callPaths.map((p) => `- ${p}`).join('\n')}` : null,
      graph.directCallers.length
        ? `DIRECT CALLERS:\n${graph.directCallers.slice(0, 20).map((c) => `- ${c.filePath}:${c.line} in ${c.symbol} (confidence ${c.confidence})`).join('\n')}`
        : 'DIRECT CALLERS: none found in the indexed graph.',
      graph.importers.length ? `MODULE IMPORTERS:\n${graph.importers.slice(0, 15).map((i) => `- ${i.filePath}`).join('\n')}` : null,
      graph.routes.length ? `API ROUTES IN AFFECTED FILES:\n${graph.routes.map((r) => `- ${r.method} ${r.path} -> ${r.handler} (${r.filePath})`).join('\n')}` : 'API ROUTES: none detected.',
      graph.tests.length ? `TESTS TOUCHING IT:\n${[...new Set(graph.tests)].map((t) => `- ${t}`).join('\n')}` : 'TESTS: no test file references this symbol.',
      semanticOnly.length
        ? `SEMANTICALLY RELATED CODE (vector search):\n${semanticOnly.slice(0, 4).map(renderChunk).join('\n\n')}`
        : null,
    ]);

    const prompt = [
      context,
      `Assess the blast radius of changing \`${symbolName}\`.`,
      'Explain what could break and why, tracing the concrete call paths above. Distinguish structural certainty from semantic guesses. Mention missing test coverage only if the data above shows it.',
    ].join('\n\n');

    const result = await invokeText({
      system: IMPACT_SYSTEM_PROMPT,
      user: prompt,
      temperature: 0.2,
      maxTokens: Math.min(1200, budget.outputTokens),
    });
    explanation = result.text;
    usage = result.usage;
    model = result.model;
  }

  const riskLevel = graph.counts.high > 0 ? 'HIGH' : graph.counts.medium > 0 ? 'MEDIUM' : 'LOW';

  logger.info(
    { repo: repositoryDoc.fullName, symbol: symbolName, ...graph.counts, riskLevel },
    'Impact analysis computed',
  );

  return {
    symbol: graph.symbol,
    riskLevel,
    definitions: graph.definitions.map((d) => ({
      filePath: d.filePath,
      startLine: d.startLine,
      endLine: d.endLine,
      kind: d.kind,
      signature: d.signature,
      exported: d.exported,
      doc: d.doc,
      calls: d.calls,
    })),
    impacts: graph.impacts,
    callPaths: graph.callPaths,
    routes: graph.routes,
    tests: [...new Set(graph.tests)],
    counts: graph.counts,
    semanticMatches: semanticOnly.slice(0, 6).map((c) => ({
      filePath: c.filePath,
      symbolName: c.symbolName,
      startLine: c.startLine,
      endLine: c.endLine,
      score: c.score,
    })),
    explanation,
    model,
    usage,
  };
}
