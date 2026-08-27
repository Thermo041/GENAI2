import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import {
  calleeName,
  detectRoute,
  isComponentName,
  isHookName,
  leadingDoc,
  memberPath,
  paramNames,
} from './astHelpers.js';

const traverse = _traverse.default || _traverse;

const PLUGINS = [
  'jsx',
  'typescript',
  'decorators-legacy',
  'classProperties',
  'classPrivateProperties',
  'classPrivateMethods',
  'exportDefaultFrom',
  'exportNamespaceFrom',
  'topLevelAwait',
];

export function parseToAst(code) {
  return parse(code, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowSuperOutsideMethod: true,
    allowUndeclaredExports: true,
    errorRecovery: true,
    attachComment: true,
    plugins: PLUGINS,
  });
}

function buildSymbol(node, name, kind, fnNode) {
  const fn = fnNode || node;
  const start = node.loc?.start.line || 0;
  const end = node.loc?.end.line || start;
  const params = paramNames(fn.params || []);
  return {
    name,
    kind,
    className: '',
    qualifiedName: name,
    startLine: start,
    endLine: end,
    loc: Math.max(1, end - start + 1),
    params,
    exported: false,
    isAsync: Boolean(fn.async),
    signature:
      kind === 'class' ? `class ${name}` : `${fn.async ? 'async ' : ''}${name}(${params.join(', ')})`,
    doc: leadingDoc(node),
    calls: [],
  };
}

function hasJsx(path) {
  let found = false;
  path.traverse({
    JSXElement() {
      found = true;
    },
    JSXFragment() {
      found = true;
    },
  });
  return found;
}

function kindForFunction(name, path) {
  if (isHookName(name)) return 'hook';
  if (isComponentName(name) && hasJsx(path)) return 'component';
  return 'function';
}

/**
 * Single-pass AST extraction for the JS/TS family: imports, exports, functions,
 * classes, methods, React components/hooks, Express routes, and call sites
 * attributed to their enclosing symbol. This structural data (not embeddings)
 * is what drives impact analysis.
 */
export function analyzeJsFile(filePath, code) {
  const result = { filePath, parseOk: true, imports: [], exports: [], symbols: [], routes: [], calls: [] };

  let ast;
  try {
    ast = parseToAst(code);
  } catch (err) {
    return { ...result, parseOk: false, parseError: String(err.message).slice(0, 200) };
  }

  const stack = [];
  const pushedNodes = new WeakSet();
  const current = () => stack[stack.length - 1] || null;

  const addImport = (raw, specifiers, line) => {
    if (!raw || typeof raw !== 'string') return;
    result.imports.push({
      raw,
      specifiers: (specifiers || []).filter(Boolean),
      isExternal: !raw.startsWith('.') && !raw.startsWith('/'),
      line: line || 0,
    });
  };

  const open = (path, symbol) => {
    result.symbols.push(symbol);
    stack.push(symbol);
    pushedNodes.add(path.node);
  };

  const close = (path) => {
    if (pushedNodes.has(path.node)) stack.pop();
  };

  const visitors = {
    ImportDeclaration(path) {
      addImport(
        path.node.source.value,
        path.node.specifiers.map((s) => s.local?.name),
        path.node.loc?.start.line,
      );
    },
    ExportNamedDeclaration(path) {
      if (path.node.source) addImport(path.node.source.value, [], path.node.loc?.start.line);
      for (const specifier of path.node.specifiers || []) {
        const name = specifier.exported?.name || specifier.exported?.value;
        if (name) result.exports.push(name);
      }
      const declaration = path.node.declaration;
      if (declaration?.id?.name) result.exports.push(declaration.id.name);
      for (const declarator of declaration?.declarations || []) {
        if (declarator.id?.name) result.exports.push(declarator.id.name);
      }
    },
    ExportDefaultDeclaration(path) {
      result.exports.push(path.node.declaration?.id?.name || 'default');
    },
    AssignmentExpression: {
      enter(path) {
        // CommonJS: module.exports = x / module.exports = { a, b } / exports.foo = fn
        const target = memberPath(path.node.left);
        const right = path.node.right;

        if (target === 'module.exports' || target === 'exports') {
          if (right?.type === 'ObjectExpression') {
            for (const property of right.properties || []) {
              const key = property.key?.name || property.key?.value;
              if (key) result.exports.push(key);
            }
          } else {
            result.exports.push('default');
          }
        } else if (target.startsWith('exports.')) {
          result.exports.push(target.slice('exports.'.length));
        } else if (target.startsWith('module.exports.')) {
          result.exports.push(target.slice('module.exports.'.length));
        }

        // Function-valued assignment: schema.statics.isEmailTaken = async function () {}
        // or Klass.prototype.method = () => {}. Very common in Mongoose/older JS.
        if (right?.type === 'FunctionExpression' || right?.type === 'ArrowFunctionExpression') {
          const parts = target.split('.');
          const name = parts[parts.length - 1];
          if (name && name !== 'exports' && parts.length > 1) {
            const symbol = buildSymbol(path.node, name, kindForFunction(name, path), right);
            symbol.className = parts.slice(0, -1).join('.');
            symbol.qualifiedName = target;
            open(path, symbol);
          }
        }
      },
      exit: close,
    },
    FunctionDeclaration: {
      enter(path) {
        const name = path.node.id?.name;
        if (!name) return;
        const symbol = buildSymbol(path.node, name, kindForFunction(name, path));
        symbol.doc = symbol.doc || leadingDoc(path.parent);
        open(path, symbol);
      },
      exit: close,
    },
    ClassDeclaration: {
      enter(path) {
        const name = path.node.id?.name;
        if (!name) return;
        const symbol = buildSymbol(path.node, name, 'class');
        symbol.doc = symbol.doc || leadingDoc(path.parent);
        if (path.node.superClass) symbol.signature += ` extends ${memberPath(path.node.superClass)}`;
        open(path, symbol);
      },
      exit: close,
    },
    ClassMethod: {
      enter(path) {
        const name = path.node.key?.name || path.node.key?.value;
        if (!name) return;
        const className = path.findParent((p) => p.isClassDeclaration())?.node?.id?.name || '';
        const symbol = buildSymbol(path.node, name, 'method');
        symbol.className = className;
        symbol.qualifiedName = className ? `${className}.${name}` : name;
        open(path, symbol);
      },
      exit: close,
    },
    ObjectMethod: {
      enter(path) {
        const name = path.node.key?.name || path.node.key?.value;
        if (name) open(path, buildSymbol(path.node, name, 'method'));
      },
      exit: close,
    },
    VariableDeclarator: {
      enter(path) {
        const name = path.node.id?.name;
        const init = path.node.init;
        if (!name || !init) return;
        const declaration = path.parentPath?.node || path.node;

        if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
          const symbol = buildSymbol(path.node, name, kindForFunction(name, path), init);
          symbol.doc = leadingDoc(declaration) || symbol.doc;
          open(path, symbol);
          return;
        }

        // Higher-order wrappers are the norm in Express codebases:
        //   const createUser = catchAsync(async (req, res) => { ... });
        // Without this, the handler would be invisible to the graph.
        if (init.type === 'CallExpression') {
          const inner = (init.arguments || []).find(
            (arg) => arg?.type === 'ArrowFunctionExpression' || arg?.type === 'FunctionExpression',
          );
          if (inner) {
            const symbol = buildSymbol(path.node, name, kindForFunction(name, path), inner);
            symbol.doc = leadingDoc(declaration) || symbol.doc;
            symbol.signature = `${inner.async ? 'async ' : ''}${name}(${paramNames(inner.params || []).join(', ')}) via ${calleeName(init.callee) || 'wrapper'}`;
            open(path, symbol);
          }
        }
      },
      exit: close,
    },
    CallExpression(path) {
      const { node } = path;
      const line = node.loc?.start.line || 0;
      const name = calleeName(node.callee);

      if (name === 'require' && node.arguments[0]?.type === 'StringLiteral') {
        addImport(node.arguments[0].value, [], line);
        return;
      }
      if (node.callee.type === 'Import' && node.arguments[0]?.type === 'StringLiteral') {
        addImport(node.arguments[0].value, [], line);
        return;
      }

      const route = detectRoute(node);
      if (route) {
        result.routes.push({ ...route, line });
        result.symbols.push({
          ...buildSymbol(node, `${route.method} ${route.path}`, 'route'),
          signature: `${route.method} ${route.path} -> ${route.handler || 'inline handler'}`,
          calls: route.handler ? route.handler.split(', ').filter(Boolean) : [],
        });
      }

      if (!name) return;
      const enclosing = current();
      result.calls.push({
        from: enclosing?.qualifiedName || enclosing?.name || '<module>',
        to: name,
        receiver: node.callee.type === 'MemberExpression' ? memberPath(node.callee.object) : '',
        line,
      });
      if (enclosing && !enclosing.calls.includes(name)) enclosing.calls.push(name);
    },
  };

  try {
    traverse(ast, visitors);
  } catch (err) {
    // Babel's scope tracker throws on code that parses but is semantically
    // invalid (duplicate declarations, for example). Keep whatever we collected
    // rather than losing the whole file.
    result.parseOk = false;
    result.parseError = String(err.message).slice(0, 200);
  }

  result.exports = [...new Set(result.exports.filter(Boolean))];
  const exportSet = new Set(result.exports);
  for (const symbol of result.symbols) {
    if (exportSet.has(symbol.name) || exportSet.has(symbol.qualifiedName)) symbol.exported = true;
  }
  return result;
}
