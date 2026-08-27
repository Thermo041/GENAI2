import mongoose from 'mongoose';

/**
 * A repository CodeWeave knows about. `permissions` is a cache of what GitHub
 * reported for the *last user who touched it* — authorisation is always
 * re-checked against GitHub before any write, this is only for UI hints.
 */
const repositorySchema = new mongoose.Schema(
  {
    githubRepositoryId: { type: Number, required: true, index: true },
    owner: { type: String, required: true },
    name: { type: String, required: true },
    fullName: { type: String, required: true, index: true },
    url: { type: String, default: '' },
    description: { type: String, default: '' },
    visibility: { type: String, enum: ['public', 'private', 'internal'], default: 'public' },
    isFork: { type: Boolean, default: false },
    parentFullName: { type: String, default: '' },
    defaultBranch: { type: String, default: 'main' },
    primaryLanguage: { type: String, default: '' },
    languages: { type: Map, of: Number, default: undefined },
    stars: { type: Number, default: 0 },
    sizeKb: { type: Number, default: 0 },
    topics: { type: [String], default: [] },
    pushedAt: { type: Date, default: null },

    // Indexing state
    indexingStatus: {
      type: String,
      enum: ['not_indexed', 'queued', 'indexing', 'indexed', 'failed', 'partial'],
      default: 'not_indexed',
      index: true,
    },
    indexedBranch: { type: String, default: '' },
    lastIndexedCommitSha: { type: String, default: '' },
    lastIndexedAt: { type: Date, default: null },
    // Identifies the current index generation. Vectors from older generations
    // are deleted after a successful full index, which is what keeps Qdrant in
    // sync when files are dropped or chunk boundaries move.
    indexRunId: { type: String, default: '' },
    indexStats: {
      filesDiscovered: { type: Number, default: 0 },
      sourceFiles: { type: Number, default: 0 },
      filesIndexed: { type: Number, default: 0 },
      filesSkipped: { type: Number, default: 0 },
      chunks: { type: Number, default: 0 },
      symbols: { type: Number, default: 0 },
      edges: { type: Number, default: 0 },
      truncated: { type: Boolean, default: false },
    },
    // Dependency manifest captured while indexing, so framework/data-store
    // detection needs no GitHub call when the overview is read.
    manifest: {
      found: { type: [String], default: [] },
      dependencies: { type: [String], default: [] },
      scripts: { type: mongoose.Schema.Types.Mixed, default: undefined },
      name: { type: String, default: '' },
      description: { type: String, default: '' },
    },
    overview: {
      generatedAt: { type: Date, default: null },
      commitSha: { type: String, default: '' },
      summary: { type: String, default: '' },
      architecture: { type: String, default: '' },
      entryPoints: { type: [String], default: [] },
      importantDirectories: { type: [mongoose.Schema.Types.Mixed], default: [] },
      frameworks: { type: [String], default: [] },
      databases: { type: [String], default: [] },
      apiSurface: { type: [mongoose.Schema.Types.Mixed], default: [] },
      dependencies: { type: [String], default: [] },
    },

    // Users who have analysed this repository, with GitHub-reported permissions
    accessRecords: {
      type: [
        new mongoose.Schema(
          {
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
            permissions: {
              admin: { type: Boolean, default: false },
              maintain: { type: Boolean, default: false },
              push: { type: Boolean, default: false },
              triage: { type: Boolean, default: false },
              pull: { type: Boolean, default: false },
            },
            role: { type: String, default: 'read' },
            lastCheckedAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

repositorySchema.index({ owner: 1, name: 1 }, { unique: true });
repositorySchema.index({ 'accessRecords.userId': 1, updatedAt: -1 });

export const Repository = mongoose.models.Repository || mongoose.model('Repository', repositorySchema);
