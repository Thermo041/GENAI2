/** Small helpers shared by the Babel-based extractor. */

export function calleeName(node) {
  if (!node) return '';
  switch (node.type) {
    case 'Identifier':
      return node.name;
    case 'MemberExpression': {
      const prop = node.property;
      const name = prop?.type === 'Identifier' ? prop.name : prop?.type === 'StringLiteral' ? prop.value : '';
      return name || '';
    }
    case 'CallExpression':
      return calleeName(node.callee);
    default:
      return '';
  }
}

/** "db.users.findOne" style receiver path, useful for method-call attribution. */
export function memberPath(node, depth = 0) {
  if (!node || depth > 6) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'MemberExpression') {
    const object = memberPath(node.object, depth + 1);
    const prop = node.property?.type === 'Identifier' ? node.property.name : '';
    return object && prop ? `${object}.${prop}` : prop || object;
  }
  return '';
}

export function paramNames(params = []) {
  return params
    .map((param) => {
      switch (param.type) {
        case 'Identifier':
          return param.name;
        case 'ObjectPattern':
          return `{ ${param.properties
            .map((p) => (p.type === 'ObjectProperty' && p.key.type === 'Identifier' ? p.key.name : '...'))
            .join(', ')} }`;
        case 'ArrayPattern':
          return '[...]';
        case 'RestElement':
          return `...${param.argument?.name || 'rest'}`;
        case 'AssignmentPattern':
          return param.left?.name || 'arg';
        default:
          return 'arg';
      }
    })
    .filter(Boolean);
}

export function leadingDoc(node) {
  const comments = node?.leadingComments;
  if (!comments?.length) return '';
  const block = comments[comments.length - 1];
  return String(block.value || '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 400);
}

export function isComponentName(name) {
  return typeof name === 'string' && /^[A-Z][A-Za-z0-9]*$/.test(name);
}

export function isHookName(name) {
  return typeof name === 'string' && /^use[A-Z]/.test(name);
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all', 'use']);

/** Detects Express-style route registrations: app.get('/x', handler). */
export function detectRoute(node) {
  if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return null;
  const method = node.callee.property?.name;
  if (!method || !HTTP_METHODS.has(method)) return null;
  const receiver = memberPath(node.callee.object);
  if (!/^(app|router|server|api|route|_router)$/i.test(receiver.split('.').pop() || '')) return null;
  const first = node.arguments?.[0];
  if (!first || (first.type !== 'StringLiteral' && first.type !== 'TemplateLiteral')) return null;
  const path =
    first.type === 'StringLiteral'
      ? first.value
      : first.quasis.map((q) => q.value.cooked).join(':param');
  const handlers = (node.arguments || []).slice(1).map((arg) => {
    if (arg.type === 'Identifier') return arg.name;
    if (arg.type === 'MemberExpression') return memberPath(arg);
    if (arg.type === 'CallExpression') return calleeName(arg.callee);
    return '';
  });
  return { method: method.toUpperCase(), path, handler: handlers.filter(Boolean).join(', ') };
}

/** Node kinds that own a scope we attribute calls to. */
export const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassMethod',
  'ObjectMethod',
  'ClassPrivateMethod',
]);
