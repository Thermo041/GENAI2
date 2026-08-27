import { isTestPath } from '../../utils/fileFilter.js';

const MIN_CHUNK_CHARS = 40;

function sliceLines(lines, startLine, endLine) {
  return lines.slice(Math.max(0, startLine - 1), Math.min(lines.length, endLine)).join('\n');
}

/** Embedding text = a compact header (path/symbol) + the code itself. The header
 *  measurably improves retrieval for questions phrased around file or feature
 *  names rather than code tokens. */
export function buildChunkText({ filePath, symbolName, symbolType, startLine, endLine, code, doc }) {
  const header = [
    `file: ${filePath}`,
    symbolName && symbolName !== '<module>' ? `${symbolType}: ${symbolName}` : null,
    `lines: ${startLine}-${endLine}`,
    doc ? `doc: ${doc}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
  return `${header}\n${code}`;
}

function splitOversized(chunk, maxChars, lines) {
  if (chunk.code.length <= maxChars) return [chunk];
  const out = [];
  const totalLines = chunk.endLine - chunk.startLine + 1;
  const approxLinesPerChunk = Math.max(
    12,
    Math.ceil(totalLines / Math.ceil(chunk.code.length / maxChars)),
  );
  for (let offset = 0; offset < totalLines; offset += approxLinesPerChunk) {
    const startLine = chunk.startLine + offset;
    const endLine = Math.min(chunk.endLine, startLine + approxLinesPerChunk - 1 + 2); // 2-line overlap
    const code = sliceLines(lines, startLine, endLine);
    if (code.trim().length < MIN_CHUNK_CHARS) continue;
    out.push({
      ...chunk,
      startLine,
      endLine,
      code,
      part: out.length + 1,
      symbolName: chunk.symbolName ? `${chunk.symbolName}#${out.length + 1}` : chunk.symbolName,
    });
  }
  return out.length ? out : [chunk];
}

/**
 * Structure-aware chunking:
 *  - one chunk per function / class / method / route (from the AST)
 *  - the module preamble (imports + top-level config) as its own chunk
 *  - gaps between symbols kept so nothing is silently dropped
 *  - prose/config files split on blank-line blocks
 * Oversized units are split on line boundaries with a small overlap.
 */
export function chunkFile({ filePath, content, language, analysis, maxChars = 1800 }) {
  const lines = content.split('\n');
  const isTest = isTestPath(filePath);
  const symbols = (analysis?.symbols || [])
    .filter((s) => s.startLine > 0 && s.endLine >= s.startLine)
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);

  const units = [];

  if (symbols.length === 0) {
    units.push(...blockChunks(lines, maxChars));
  } else {
    // Keep only outermost symbols so methods are not duplicated inside classes,
    // unless the class is large — then prefer its methods.
    const topLevel = [];
    for (const symbol of symbols) {
      const parent = topLevel[topLevel.length - 1];
      if (parent && symbol.startLine >= parent.startLine && symbol.endLine <= parent.endLine) {
        const parentCode = sliceLines(lines, parent.startLine, parent.endLine);
        if (parentCode.length > maxChars) topLevel.push(symbol);
        continue;
      }
      topLevel.push(symbol);
    }

    const firstStart = topLevel[0].startLine;
    if (firstStart > 3) {
      const code = sliceLines(lines, 1, firstStart - 1);
      if (code.trim().length >= MIN_CHUNK_CHARS) {
        units.push({ symbolName: '<module>', symbolType: 'module', startLine: 1, endLine: firstStart - 1, code, doc: '' });
      }
    }

    let cursor = 0;
    for (const symbol of topLevel) {
      if (symbol.startLine > cursor + 1 && cursor > 0) {
        const gapCode = sliceLines(lines, cursor + 1, symbol.startLine - 1);
        if (gapCode.trim().length >= 120) {
          units.push({ symbolName: '<module>', symbolType: 'module', startLine: cursor + 1, endLine: symbol.startLine - 1, code: gapCode, doc: '' });
        }
      }
      units.push({
        symbolName: symbol.qualifiedName || symbol.name,
        symbolType: symbol.kind,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        code: sliceLines(lines, symbol.startLine, symbol.endLine),
        doc: symbol.doc || '',
        exported: symbol.exported,
        signature: symbol.signature || '',
      });
      cursor = Math.max(cursor, symbol.endLine);
    }

    if (cursor < lines.length - 1) {
      const tail = sliceLines(lines, cursor + 1, lines.length);
      if (tail.trim().length >= 120) {
        units.push({ symbolName: '<module>', symbolType: 'module', startLine: cursor + 1, endLine: lines.length, code: tail, doc: '' });
      }
    }
  }

  const chunks = [];
  for (const unit of units) {
    if (unit.code.trim().length < MIN_CHUNK_CHARS) continue;
    for (const piece of splitOversized(unit, maxChars, lines)) {
      chunks.push({
        filePath,
        language,
        isTest,
        symbolName: piece.symbolName || '<module>',
        symbolType: piece.symbolType || 'module',
        startLine: piece.startLine,
        endLine: piece.endLine,
        exported: Boolean(piece.exported),
        signature: piece.signature || '',
        code: piece.code,
        text: buildChunkText({ filePath, ...piece }),
      });
    }
  }
  return chunks;
}

/** Blank-line block splitting for markdown/config/CSS/etc. */
function blockChunks(lines, maxChars) {
  const units = [];
  let startLine = 1;
  let buffer = [];
  const flush = (endLine) => {
    const code = buffer.join('\n');
    if (code.trim().length >= MIN_CHUNK_CHARS) {
      units.push({ symbolName: '<module>', symbolType: 'block', startLine, endLine, code, doc: '' });
    }
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    buffer.push(lines[i]);
    const joined = buffer.join('\n');
    const isHeading = /^#{1,3}\s/.test(lines[i + 1] || '');
    if (joined.length >= maxChars || (isHeading && joined.length > 300)) {
      flush(i + 1);
      startLine = i + 2;
    }
  }
  if (buffer.length) flush(lines.length);
  return units;
}
