import { CodeSymbol } from '../../models/CodeSymbol.js';
import { CodeEdge } from '../../models/CodeEdge.js';
import { embedQuery } from '../embeddings/index.js';
import { searchChunks, fetchChunksForFiles, fetchRepositoryChunks } from '../qdrant/store.js';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'how', 'does', 'what', 'where', 'why', 'when', 'this', 'that', 'from',
  'into', 'about', 'code', 'file', 'files', 'function', 'class', 'method', 'work', 'works', 'used',
  'use', 'using', 'there', 'these', 'those', 'have', 'has', 'can', 'would', 'should', 'could', 'main',
  'repo', 'repository', 'project', 'app', 'add', 'change', 'update', 'implement', 'explain', 'show',
]);

/** Identifier-looking tokens in a question: processPayment, user_service, AuthController. */
export function extractIdentifiers(question) {
  const tokens = String(question).match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || [];
  const seen = new Set();
  const out = [];
  for (const token of tokens) {
    const isIdentifier = /[A-Z]/.test(token.slice(1)) || token.includes('_') || /\(\)/.test(token);
    const key = token.toLowerCase();
    if (STOP_WORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    if (isIdentifier || token.length > 5) out.push(token);
  }
  return out.slice(0, 8);
}

const chunkKey = (chunk) => `${chunk.filePath}:${chunk.startLine}`;

/**
 * Hybrid retrieval.
 *
 *  1. SEMANTIC   — MiniLM query embedding -> Qdrant, filtered to this repository.
 *  2. STRUCTURAL — identifiers in the question matched against AST symbols, and
 *                  the files those symbols live in pulled in directly.
 *  3. GRAPH      — one hop of importers/callers around the best-scoring files.
 *
 * Pure vector search misses "where is processPayment used?"; the graph hop is
 * what makes the answer trace real call paths.
 */
export async function retrieveContext({
  repositoryId,
  question,
  limit = 12,
  maxChars = 16000,
  excludeTests = false,
  includeGraph = true,
}) {
  const vector = await embedQuery(question);
  const semantic = await searchChunks({ repositoryId, vector, limit, excludeTests });

  const identifiers = extractIdentifiers(question);
  const selected = new Map();
  const sources = { semantic: 0, structural: 0, graph: 0, fallback: 0 };

  const add = (chunk, origin, score) => {
    const key = chunkKey(chunk);
    if (selected.has(key)) return;
    selected.set(key, { ...chunk, origin, rank: score });
    sources[origin] += 1;
  };

  let matchedSymbols = [];
  if (identifiers.length) {
    matchedSymbols = await CodeSymbol.find({
      repositoryId,
      name: { $in: identifiers },
    })
      .select('filePath name qualifiedName kind startLine endLine signature')
      .limit(12)
      .lean();

    if (matchedSymbols.length) {
      const structural = await fetchChunksForFiles({
        repositoryId,
        filePaths: [...new Set(matchedSymbols.map((s) => s.filePath))],
        limit: 60,
      });
      for (const symbol of matchedSymbols) {
        const hit = structural.find(
          (c) => c.filePath === symbol.filePath && c.startLine <= symbol.startLine + 2 && c.endLine >= symbol.startLine,
        );
        if (hit) add(hit, 'structural', 1);
      }
    }
  }

  for (const chunk of semantic) add(chunk, 'semantic', chunk.score);

  const graphNotes = [];
  if (includeGraph) {
    const focusFiles = [...new Set([...matchedSymbols.map((s) => s.filePath), ...semantic.slice(0, 3).map((c) => c.filePath)])];
    if (focusFiles.length) {
      const edges = await CodeEdge.find({
        repositoryId,
        $or: [
          { toFile: { $in: focusFiles }, type: { $in: ['calls', 'imports'] } },
          { fromFile: { $in: focusFiles }, type: 'calls' },
        ],
      })
        .select('type fromFile fromSymbol toFile toSymbol toName line confidence')
        .limit(60)
        .lean();

      const neighbourFiles = [
        ...new Set(
          edges
            .flatMap((e) => [e.fromFile, e.toFile])
            .filter((f) => f && !focusFiles.includes(f)),
        ),
      ].slice(0, 6);

      for (const edge of edges.slice(0, 12)) {
        if (edge.type === 'calls' && edge.toSymbol) {
          graphNotes.push(`${edge.fromFile}:${edge.line} ${edge.fromSymbol || '<module>'} -> ${edge.toSymbol} (${edge.toFile || 'external'})`);
        } else if (edge.type === 'imports' && edge.toFile) {
          graphNotes.push(`${edge.fromFile} imports ${edge.toFile}`);
        }
      }

      if (neighbourFiles.length) {
        const neighbours = await fetchChunksForFiles({ repositoryId, filePaths: neighbourFiles, limit: 24 });
        for (const chunk of neighbours.slice(0, 6)) add(chunk, 'graph', 0.2);
      }
    }
  }

  // Nothing cleared the similarity threshold. For a small repository the whole
  // index fits in the prompt, so answer from all of it rather than refusing.
  if (selected.size === 0) {
    const everything = await fetchRepositoryChunks({ repositoryId, limit: 20 });
    for (const chunk of everything) add(chunk, 'fallback', 0.05);
  }

  const ordered = [...selected.values()].sort((a, b) => {
    const weight = { structural: 3, semantic: 2, graph: 1, fallback: 0 };
    if (weight[a.origin] !== weight[b.origin]) return weight[b.origin] - weight[a.origin];
    return (b.rank ?? 0) - (a.rank ?? 0);
  });

  const chunks = [];
  let used = 0;
  for (const chunk of ordered) {
    const cost = chunk.code.length + 120;
    if (used + cost > maxChars && chunks.length >= 4) continue;
    chunks.push(chunk);
    used += cost;
  }

  return {
    chunks,
    identifiers,
    matchedSymbols,
    graphNotes: [...new Set(graphNotes)].slice(0, 14),
    stats: { ...sources, returned: chunks.length, contextChars: used, topScore: semantic[0]?.score ?? 0 },
  };
}

export function citationsFrom(chunks) {
  const seen = new Set();
  const citations = [];
  for (const chunk of chunks) {
    const key = `${chunk.filePath}:${chunk.startLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      symbolName: chunk.symbolName === '<module>' ? '' : chunk.symbolName,
      score: chunk.rank ?? chunk.score ?? 0,
    });
  }
  return citations.slice(0, 12);
}
