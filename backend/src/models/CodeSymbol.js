import mongoose from 'mongoose';

/** A function / class / method / route handler extracted by the AST parser. */
const codeSymbolSchema = new mongoose.Schema(
  {
    repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true },
    commitSha: { type: String, required: true },
    filePath: { type: String, required: true },
    language: { type: String, default: 'text' },

    name: { type: String, required: true },
    qualifiedName: { type: String, default: '' },
    kind: {
      type: String,
      enum: ['function', 'method', 'class', 'constant', 'component', 'route', 'hook', 'type'],
      default: 'function',
    },
    className: { type: String, default: '' },
    signature: { type: String, default: '' },
    params: { type: [String], default: [] },
    exported: { type: Boolean, default: false },
    isAsync: { type: Boolean, default: false },
    isTest: { type: Boolean, default: false },
    doc: { type: String, default: '' },

    startLine: { type: Number, default: 0 },
    endLine: { type: Number, default: 0 },
    loc: { type: Number, default: 0 },
    calls: { type: [String], default: [] },
  },
  { timestamps: false },
);

codeSymbolSchema.index({ repositoryId: 1, name: 1 });
codeSymbolSchema.index({ repositoryId: 1, filePath: 1, startLine: 1 });
codeSymbolSchema.index({ repositoryId: 1, kind: 1 });

export const CodeSymbol = mongoose.models.CodeSymbol || mongoose.model('CodeSymbol', codeSymbolSchema);
