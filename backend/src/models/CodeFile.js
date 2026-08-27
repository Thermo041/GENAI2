import mongoose from 'mongoose';

const importSchema = new mongoose.Schema(
  {
    raw: { type: String, required: true },
    resolved: { type: String, default: '' },
    isExternal: { type: Boolean, default: false },
    specifiers: { type: [String], default: [] },
    line: { type: Number, default: 0 },
  },
  { _id: false },
);

const routeSchema = new mongoose.Schema(
  {
    method: { type: String, default: 'USE' },
    path: { type: String, default: '' },
    handler: { type: String, default: '' },
    line: { type: Number, default: 0 },
  },
  { _id: false },
);

/** Structural facts about one indexed file at one commit. */
const codeFileSchema = new mongoose.Schema(
  {
    repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true },
    commitSha: { type: String, required: true },
    filePath: { type: String, required: true },
    language: { type: String, default: 'text' },
    lines: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
    isTest: { type: Boolean, default: false },
    parseOk: { type: Boolean, default: true },
    imports: { type: [importSchema], default: [] },
    exports: { type: [String], default: [] },
    routes: { type: [routeSchema], default: [] },
    symbolCount: { type: Number, default: 0 },
    chunkCount: { type: Number, default: 0 },
    contentSha: { type: String, default: '' },
  },
  { timestamps: true },
);

codeFileSchema.index({ repositoryId: 1, filePath: 1 }, { unique: true });
codeFileSchema.index({ repositoryId: 1, language: 1 });

export const CodeFile = mongoose.models.CodeFile || mongoose.model('CodeFile', codeFileSchema);
