import mongoose from 'mongoose';

/**
 * One edge of the code relationship graph.
 *   imports : fileA -> fileB (module dependency)
 *   calls   : symbolA -> symbolB (call site, resolved when possible)
 *   defines : file -> symbol
 *   tests   : test file -> symbol under test
 *   routes  : route definition -> handler symbol
 */
const codeEdgeSchema = new mongoose.Schema(
  {
    repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true },
    commitSha: { type: String, required: true },
    type: { type: String, enum: ['imports', 'calls', 'defines', 'tests', 'routes'], required: true },

    fromFile: { type: String, required: true },
    fromSymbol: { type: String, default: '' },
    toFile: { type: String, default: '' },
    toSymbol: { type: String, default: '' },
    toName: { type: String, default: '' },
    line: { type: Number, default: 0 },
    external: { type: Boolean, default: false },
    confidence: { type: Number, default: 0.5 },
  },
  { timestamps: false },
);

codeEdgeSchema.index({ repositoryId: 1, toName: 1, type: 1 });
codeEdgeSchema.index({ repositoryId: 1, fromFile: 1, type: 1 });
codeEdgeSchema.index({ repositoryId: 1, toFile: 1, type: 1 });

export const CodeEdge = mongoose.models.CodeEdge || mongoose.model('CodeEdge', codeEdgeSchema);
