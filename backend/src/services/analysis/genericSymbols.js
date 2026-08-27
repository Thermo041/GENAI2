/**
 * Lightweight symbol extraction for languages outside the JS family. Regex
 * based and deliberately conservative: it produces good chunk boundaries and
 * searchable symbol names without pretending to be a real parser.
 */

const RULES = {
  python: [
    { re: /^(\s*)def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/gm, kind: 'function', nameIdx: 2, paramIdx: 3 },
    { re: /^(\s*)async\s+def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/gm, kind: 'function', nameIdx: 2, paramIdx: 3, async: true },
    { re: /^(\s*)class\s+([A-Za-z_][\w]*)/gm, kind: 'class', nameIdx: 2 },
  ],
  java: [
    { re: /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/gm, kind: 'class', nameIdx: 1 },
    { re: /^\s*(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?[\w<>[\],\s.?]+\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:throws [\w,\s.]+)?\{/gm, kind: 'method', nameIdx: 1, paramIdx: 2 },
  ],
  kotlin: [
    { re: /^\s*(?:override\s+|private\s+|internal\s+|suspend\s+)*fun\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, kind: 'function', nameIdx: 1, paramIdx: 2 },
    { re: /^\s*(?:data\s+|sealed\s+|abstract\s+|open\s+)*class\s+([A-Za-z_]\w*)/gm, kind: 'class', nameIdx: 1 },
  ],
  go: [
    { re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, kind: 'function', nameIdx: 1, paramIdx: 2 },
    { re: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/gm, kind: 'class', nameIdx: 1 },
  ],
  rust: [
    { re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/gm, kind: 'function', nameIdx: 1, paramIdx: 2 },
    { re: /^\s*(?:pub\s+)?(?:struct|enum|trait|impl)\s+([A-Za-z_]\w*)/gm, kind: 'class', nameIdx: 1 },
  ],
  ruby: [
    { re: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/gm, kind: 'method', nameIdx: 1 },
    { re: /^\s*(?:class|module)\s+([A-Z]\w*)/gm, kind: 'class', nameIdx: 1 },
  ],
  php: [
    { re: /^\s*(?:public|private|protected|static|\s)*function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, kind: 'function', nameIdx: 1, paramIdx: 2 },
    { re: /^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+([A-Za-z_]\w*)/gm, kind: 'class', nameIdx: 1 },
  ],
  csharp: [
    { re: /^\s*(?:public|private|protected|internal)\s+(?:static\s+|virtual\s+|override\s+|async\s+)*[\w<>[\],\s?]+\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, kind: 'method', nameIdx: 1, paramIdx: 2 },
    { re: /^\s*(?:public|internal|abstract|sealed|\s)*(?:class|interface|record|struct)\s+([A-Za-z_]\w*)/gm, kind: 'class', nameIdx: 1 },
  ],
  c: [
    { re: /^[A-Za-z_][\w\s*]*\s+\*?([A-Za-z_]\w*)\s*\(([^;{)]*)\)\s*\{/gm, kind: 'function', nameIdx: 1, paramIdx: 2 },
    { re: /^\s*(?:typedef\s+)?struct\s+([A-Za-z_]\w*)/gm, kind: 'class', nameIdx: 1 },
  ],
  sql: [{ re: /create\s+(?:or\s+replace\s+)?(?:table|view|function|procedure)\s+(?:if\s+not\s+exists\s+)?[`"[]?([\w.]+)/gim, kind: 'function', nameIdx: 1 }],
  shell: [{ re: /^(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{/gm, kind: 'function', nameIdx: 1 }],
};

RULES.cpp = RULES.c;
RULES.scala = RULES.java;
RULES.swift = [
  { re: /^\s*(?:public|private|internal|open|\s)*func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, kind: 'function', nameIdx: 1, paramIdx: 2 },
  { re: /^\s*(?:public|final|open|\s)*(?:class|struct|protocol|enum)\s+([A-Za-z_]\w*)/gm, kind: 'class', nameIdx: 1 },
];

const IMPORT_RULES = {
  python: /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm,
  java: /^\s*import\s+(?:static\s+)?([\w.*]+);/gm,
  kotlin: /^\s*import\s+([\w.*]+)/gm,
  go: /^\s*(?:import\s+)?"([\w./-]+)"/gm,
  rust: /^\s*use\s+([\w:{}, ]+);/gm,
  ruby: /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/gm,
  php: /^\s*(?:use|require|include)(?:_once)?\s*\(?['"]?([\w\\/.]+)/gm,
  csharp: /^\s*using\s+([\w.]+);/gm,
  c: /^\s*#include\s+[<"]([^>"]+)[>"]/gm,
};
IMPORT_RULES.cpp = IMPORT_RULES.c;
IMPORT_RULES.scala = IMPORT_RULES.java;
IMPORT_RULES.swift = /^\s*import\s+(\w+)/gm;

function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i += 1) if (code[i] === '\n') line += 1;
  return line;
}

export function analyzeGenericFile(filePath, code, language) {
  const rules = RULES[language] || [];
  const symbols = [];
  const lines = code.split('\n');

  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let match = rule.re.exec(code);
    while (match) {
      const name = match[rule.nameIdx];
      if (name && name.length < 120) {
        const startLine = lineOf(code, match.index);
        symbols.push({
          name,
          qualifiedName: name,
          kind: rule.kind,
          className: '',
          startLine,
          endLine: startLine,
          params: rule.paramIdx && match[rule.paramIdx] ? splitParams(match[rule.paramIdx]) : [],
          exported: /^[A-Z]/.test(name) || language === 'go' ? /^[A-Z]/.test(name) : true,
          isAsync: Boolean(rule.async),
          signature: match[0].trim().slice(0, 160),
          doc: '',
          calls: [],
          loc: 1,
        });
      }
      match = rule.re.exec(code);
    }
  }

  symbols.sort((a, b) => a.startLine - b.startLine);
  for (let i = 0; i < symbols.length; i += 1) {
    const next = symbols[i + 1];
    symbols[i].endLine = next ? Math.max(symbols[i].startLine, next.startLine - 1) : lines.length;
    symbols[i].loc = symbols[i].endLine - symbols[i].startLine + 1;
  }

  const imports = [];
  const importRule = IMPORT_RULES[language];
  if (importRule) {
    importRule.lastIndex = 0;
    let match = importRule.exec(code);
    while (match) {
      const raw = match[1] || match[2];
      if (raw) {
        imports.push({
          raw,
          specifiers: [],
          isExternal: !raw.startsWith('.') && !raw.startsWith('/'),
          line: lineOf(code, match.index),
        });
      }
      match = importRule.exec(code);
    }
  }

  return { filePath, parseOk: true, imports, exports: [], symbols, routes: [], calls: [] };
}

function splitParams(raw) {
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 10);
}
