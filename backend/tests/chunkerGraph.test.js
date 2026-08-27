import { describe, expect, it } from 'vitest';
import { chunkFile } from '../src/services/analysis/chunker.js';
import { analyzeFile } from '../src/services/analysis/analyzeFile.js';
import { buildGraph } from '../src/services/analysis/graphBuilder.js';

const paymentService = `import Stripe from 'stripe';

/** Charges the customer. */
export async function processPayment(amount, userId) {
  if (amount <= 0) throw new Error('invalid');
  return stripe.charges.create({ amount, userId });
}

export function refund(chargeId) {
  return stripe.refunds.create({ charge: chargeId });
}
`;

const orderService = `import { processPayment } from './paymentService.js';

export async function createOrder(userId, amount) {
  const payment = await processPayment(amount, userId);
  return { payment };
}
`;

const orderController = `import { createOrder } from '../services/orderService.js';
const router = require('express').Router();

export async function postOrder(req, res) {
  const order = await createOrder(req.user.id, req.body.amount);
  res.json(order);
}

router.post('/orders', postOrder);
`;

const paymentTest = `import { processPayment } from '../src/services/paymentService.js';

test('rejects negative amounts', async () => {
  await expect(processPayment(-1, 'u1')).rejects.toThrow();
});
`;

function fileEntry(filePath, content) {
  const analysis = analyzeFile({ filePath, content });
  return {
    filePath,
    language: 'javascript',
    analysis,
    lines: content.split('\n').length,
    bytes: content.length,
    chunkCount: 0,
    contentSha: 'sha',
  };
}

describe('chunkFile', () => {
  const analysis = analyzeFile({ filePath: 'src/services/paymentService.js', content: paymentService });
  const chunks = chunkFile({ filePath: 'src/services/paymentService.js', content: paymentService, language: 'javascript', analysis, maxChars: 1800 });

  it('creates one chunk per symbol plus a module preamble', () => {
    const names = chunks.map((c) => c.symbolName);
    expect(names).toContain('processPayment');
    expect(names).toContain('refund');
  });

  it('carries the metadata retrieval and citations depend on', () => {
    const chunk = chunks.find((c) => c.symbolName === 'processPayment');
    expect(chunk).toMatchObject({ filePath: 'src/services/paymentService.js', language: 'javascript', symbolType: 'function', isTest: false });
    expect(chunk.startLine).toBeGreaterThan(0);
    expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    expect(chunk.code).toContain('processPayment');
    expect(chunk.text).toContain('file: src/services/paymentService.js');
  });

  it('keeps chunk text under the embedding budget by splitting oversized symbols', () => {
    const big = `export function huge() {\n${'  const x = 1;\n'.repeat(400)}}\n`;
    const bigAnalysis = analyzeFile({ filePath: 'big.js', content: big });
    const bigChunks = chunkFile({ filePath: 'big.js', content: big, language: 'javascript', analysis: bigAnalysis, maxChars: 800 });
    expect(bigChunks.length).toBeGreaterThan(1);
    for (const chunk of bigChunks) expect(chunk.code.length).toBeLessThan(2000);
  });

  it('marks test files so retrieval can exclude them', () => {
    const testAnalysis = analyzeFile({ filePath: 'tests/payment.test.js', content: paymentTest });
    const testChunks = chunkFile({ filePath: 'tests/payment.test.js', content: paymentTest, language: 'javascript', analysis: testAnalysis, maxChars: 1800 });
    expect(testChunks.every((c) => c.isTest)).toBe(true);
  });

  it('chunks prose and config files that have no symbols', () => {
    const md = `# Title\n\n${'Some documentation line.\n'.repeat(80)}`;
    const mdChunks = chunkFile({ filePath: 'README.md', content: md, language: 'markdown', analysis: { symbols: [] }, maxChars: 600 });
    expect(mdChunks.length).toBeGreaterThan(1);
    expect(mdChunks[0].symbolType).toBe('block');
  });
});

describe('buildGraph', () => {
  const files = [
    fileEntry('src/services/paymentService.js', paymentService),
    fileEntry('src/services/orderService.js', orderService),
    fileEntry('src/controllers/order.controller.js', orderController),
    fileEntry('tests/payment.test.js', paymentTest),
  ];
  const graph = buildGraph({ repositoryId: 'repo1', commitSha: 'abc123', files });
  const edges = (type) => graph.edgeDocs.filter((e) => e.type === type);

  it('writes one CodeFile document per file with resolved imports', () => {
    expect(graph.fileDocs).toHaveLength(4);
    const orderFile = graph.fileDocs.find((f) => f.filePath === 'src/services/orderService.js');
    expect(orderFile.imports[0]).toMatchObject({ raw: './paymentService.js', resolved: 'src/services/paymentService.js', isExternal: false });
  });

  it('marks third-party imports as external', () => {
    const paymentFile = graph.fileDocs.find((f) => f.filePath === 'src/services/paymentService.js');
    expect(paymentFile.imports.find((i) => i.raw === 'stripe')).toMatchObject({ isExternal: true, resolved: '' });
  });

  it('creates import edges between real files', () => {
    expect(edges('imports')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromFile: 'src/services/orderService.js', toFile: 'src/services/paymentService.js', external: false }),
      ]),
    );
  });

  it('resolves call edges through imports with high confidence', () => {
    const call = edges('calls').find((e) => e.fromFile === 'src/services/orderService.js' && e.toName === 'processPayment');
    expect(call).toBeTruthy();
    expect(call.toFile).toBe('src/services/paymentService.js');
    expect(call.fromSymbol).toBe('createOrder');
    expect(call.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('separates test edges from production call edges', () => {
    const testEdge = edges('tests').find((e) => e.fromFile === 'tests/payment.test.js' && e.toName === 'processPayment');
    expect(testEdge).toBeTruthy();
    expect(testEdge.toFile).toBe('src/services/paymentService.js');
  });

  it('creates defines edges for every symbol', () => {
    const defines = edges('defines');
    expect(defines.length).toBe(graph.symbolDocs.length);
    expect(defines.every((e) => e.confidence === 1)).toBe(true);
  });

  it('links routes to their handler symbols', () => {
    const routeEdge = edges('routes').find((e) => e.toName === 'postOrder');
    expect(routeEdge).toBeTruthy();
    expect(routeEdge.fromSymbol).toBe('POST /orders');
    expect(routeEdge.toFile).toBe('src/controllers/order.controller.js');
  });

  it('does not invent edges for unknown call targets', () => {
    const invented = graph.edgeDocs.filter((e) => e.toFile && !files.some((f) => f.filePath === e.toFile));
    expect(invented).toHaveLength(0);
  });

  it('filters framework noise out of stored symbol call lists', () => {
    const symbol = graph.symbolDocs.find((s) => s.name === 'postOrder');
    expect(symbol.calls).toContain('createOrder');
    expect(symbol.calls).not.toContain('json');
  });

  it('accepts pre-existing files and symbols for incremental resolution', () => {
    const partial = buildGraph({
      repositoryId: 'repo1',
      commitSha: 'def456',
      files: [fileEntry('src/services/orderService.js', orderService)],
      extraFilePaths: ['src/services/paymentService.js'],
      extraSymbols: [{ filePath: 'src/services/paymentService.js', name: 'processPayment', qualifiedName: 'processPayment', kind: 'function' }],
    });
    const call = partial.edgeDocs.find((e) => e.type === 'calls' && e.toName === 'processPayment');
    expect(call.toFile).toBe('src/services/paymentService.js');
  });
});
