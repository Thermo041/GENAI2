import { describe, expect, it } from 'vitest';
import { analyzeJsFile } from '../src/services/analysis/jsAst.js';
import { analyzeGenericFile } from '../src/services/analysis/genericSymbols.js';
import { analyzeFile, resolveImportPath } from '../src/services/analysis/analyzeFile.js';

const controller = `
import express from 'express';
import { processPayment } from '../services/paymentService.js';
const router = express.Router();

/** Creates an order and charges the customer. */
export async function createOrder(req, res) {
  const result = await processPayment(req.body.amount);
  return res.json({ result });
}

export class OrderService {
  async refund(orderId) {
    const order = await Order.findOne({ _id: orderId });
    return processPayment(-order.amount);
  }
}

const useOrders = () => useState(null);
export const OrderCard = ({ order }) => <div>{order.id}</div>;

router.post('/orders', createOrder);
router.get('/orders/:id', OrderService.get);
`;

describe('analyzeJsFile', () => {
  const result = analyzeJsFile('src/controllers/order.controller.jsx', controller);
  const byName = (name) => result.symbols.find((s) => s.name === name);

  it('parses without errors', () => {
    expect(result.parseOk).toBe(true);
  });

  it('extracts imports and marks externals', () => {
    expect(result.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ raw: 'express', isExternal: true }),
        expect.objectContaining({ raw: '../services/paymentService.js', isExternal: false, specifiers: ['processPayment'] }),
      ]),
    );
  });

  it('extracts exports including ESM named exports', () => {
    expect(result.exports).toEqual(expect.arrayContaining(['createOrder', 'OrderService', 'OrderCard']));
  });

  it('classifies functions, classes, methods, hooks and components', () => {
    expect(byName('createOrder')).toMatchObject({ kind: 'function', isAsync: true, exported: true });
    expect(byName('OrderService')).toMatchObject({ kind: 'class' });
    expect(byName('refund')).toMatchObject({ kind: 'method', className: 'OrderService', qualifiedName: 'OrderService.refund' });
    expect(byName('useOrders')).toMatchObject({ kind: 'hook' });
    expect(byName('OrderCard')).toMatchObject({ kind: 'component' });
  });

  it('captures JSDoc, line ranges and parameters', () => {
    const symbol = byName('createOrder');
    expect(symbol.doc).toMatch(/Creates an order/);
    expect(symbol.params).toEqual(['req', 'res']);
    expect(symbol.startLine).toBeGreaterThan(0);
    expect(symbol.endLine).toBeGreaterThan(symbol.startLine);
  });

  it('attributes call sites to the enclosing symbol', () => {
    expect(result.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'createOrder', to: 'processPayment' }),
        expect.objectContaining({ from: 'OrderService.refund', to: 'findOne', receiver: 'Order' }),
      ]),
    );
    expect(byName('createOrder').calls).toContain('processPayment');
  });

  it('detects Express routes with methods, paths and handlers', () => {
    expect(result.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'POST', path: '/orders', handler: 'createOrder' }),
        expect.objectContaining({ method: 'GET', path: '/orders/:id' }),
      ]),
    );
  });
});

describe('analyzeJsFile — CommonJS and higher-order patterns', () => {
  const code = `
const catchAsync = require('../utils/catchAsync');
const { userService } = require('../services');

const createUser = catchAsync(async (req, res) => {
  const user = await userService.createUser(req.body);
  res.status(201).send(user);
});

userSchema.statics.isEmailTaken = async function (email) {
  return this.findOne({ email });
};

module.exports = { createUser };
`;
  const result = analyzeJsFile('src/controllers/user.controller.js', code);

  it('records require() calls as imports', () => {
    expect(result.imports.map((i) => i.raw)).toEqual(expect.arrayContaining(['../utils/catchAsync', '../services']));
  });

  it('extracts handlers wrapped in higher-order functions', () => {
    const symbol = result.symbols.find((s) => s.name === 'createUser');
    expect(symbol).toBeTruthy();
    expect(symbol.isAsync).toBe(true);
    expect(symbol.params).toEqual(['req', 'res']);
    expect(symbol.exported).toBe(true);
  });

  it('extracts function-valued assignments such as Mongoose statics', () => {
    const symbol = result.symbols.find((s) => s.name === 'isEmailTaken');
    expect(symbol).toMatchObject({ qualifiedName: 'userSchema.statics.isEmailTaken' });
  });

  it('reads named keys out of module.exports objects', () => {
    expect(result.exports).toContain('createUser');
  });
});

describe('analyzeJsFile — resilience', () => {
  it('recovers from syntax errors instead of throwing', () => {
    const result = analyzeJsFile('broken.js', 'function ok() { return 1; } function broken( { ');
    expect(() => result).not.toThrow();
    expect(result.symbols.length + (result.parseOk ? 0 : 1)).toBeGreaterThan(0);
  });

  it('parses TypeScript syntax in .ts files', () => {
    const result = analyzeFile({
      filePath: 'src/service.ts',
      content: 'export interface User { id: string }\nexport async function getUser(id: string): Promise<User> { return db.find(id); }',
    });
    expect(result.symbols.find((s) => s.name === 'getUser')).toBeTruthy();
  });
});

describe('analyzeGenericFile', () => {
  it('extracts Python defs and classes with imports', () => {
    const result = analyzeGenericFile(
      'app/service.py',
      'from django.db import models\nimport os\n\nclass UserService:\n    def create_user(self, email):\n        return User.objects.create(email=email)\n',
      'python',
    );
    expect(result.symbols.map((s) => s.name)).toEqual(expect.arrayContaining(['UserService', 'create_user']));
    expect(result.imports.map((i) => i.raw)).toEqual(expect.arrayContaining(['django.db', 'os']));
  });

  it('extracts Java classes and methods', () => {
    const result = analyzeGenericFile(
      'src/main/java/App.java',
      'package com.x;\nimport java.util.List;\npublic class PaymentService {\n  public void processPayment(int amount) {\n  }\n}',
      'java',
    );
    expect(result.symbols.map((s) => s.name)).toEqual(expect.arrayContaining(['PaymentService', 'processPayment']));
  });

  it('extracts Go funcs and structs', () => {
    const result = analyzeGenericFile(
      'main.go',
      'package main\n\ntype Server struct {\n}\n\nfunc (s *Server) Handle(w http.ResponseWriter) {\n}\n\nfunc main() {\n}\n',
      'go',
    );
    expect(result.symbols.map((s) => s.name)).toEqual(expect.arrayContaining(['Server', 'Handle', 'main']));
  });
});

describe('resolveImportPath', () => {
  const files = new Set([
    'src/services/paymentService.js',
    'src/controllers/order.controller.js',
    'src/models/index.js',
    'src/utils/helpers.ts',
    'src/components/Button/index.jsx',
  ]);

  it('resolves relative imports, extensions and index files', () => {
    expect(resolveImportPath('src/controllers/order.controller.js', '../services/paymentService.js', files)).toBe('src/services/paymentService.js');
    expect(resolveImportPath('src/controllers/order.controller.js', '../services/paymentService', files)).toBe('src/services/paymentService.js');
    expect(resolveImportPath('src/controllers/order.controller.js', '../models', files)).toBe('src/models/index.js');
    expect(resolveImportPath('src/app.js', './components/Button', files)).toBe('src/components/Button/index.jsx');
  });

  it('resolves the @/ alias and ESM-to-TS rewrites', () => {
    expect(resolveImportPath('src/app.js', '@/utils/helpers', files)).toBe('src/utils/helpers.ts');
    expect(resolveImportPath('src/app.js', './utils/helpers.js', new Set(['src/utils/helpers.ts', 'src/app.js']))).toBe('src/utils/helpers.ts');
  });

  it('returns empty for third-party modules', () => {
    expect(resolveImportPath('src/app.js', 'express', files)).toBe('');
    expect(resolveImportPath('src/app.js', '@octokit/rest', files)).toBe('');
  });
});
