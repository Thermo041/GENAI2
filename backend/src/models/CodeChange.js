import mongoose from 'mongoose';

const fileChangeSchema = new mongoose.Schema(
  {
    path: { type: String, required: true },
    action: { type: String, enum: ['modify', 'create'], default: 'modify' },
    originalContent: { type: String, default: '' },
    modifiedContent: { type: String, default: '' },
    originalSha: { type: String, default: '' },
    diff: { type: String, default: '' },
    additions: { type: Number, default: 0 },
    deletions: { type: Number, default: 0 },
    rationale: { type: String, default: '' },
  },
  { _id: false },
);

/**
 * One AI-proposed change set. Nothing is written to GitHub until the user
 * accepts it, and the accept path re-validates permissions + patch safety.
 */
const codeChangeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },

    instruction: { type: String, required: true },
    summary: { type: String, default: '' },
    reasoning: { type: String, default: '' },
    warnings: { type: [String], default: [] },
    impactedSymbols: { type: [String], default: [] },

    files: { type: [fileChangeSchema], default: [] },
    totalAdditions: { type: Number, default: 0 },
    totalDeletions: { type: Number, default: 0 },

    // Where the change came from and where it will land
    baseOwner: { type: String, required: true },
    baseRepo: { type: String, required: true },
    baseBranch: { type: String, required: true },
    baseCommitSha: { type: String, default: '' },
    headOwner: { type: String, default: '' },
    headRepo: { type: String, default: '' },
    headBranch: { type: String, default: '' },
    viaFork: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ['proposed', 'rejected', 'applying', 'committed', 'pr_open', 'failed'],
      default: 'proposed',
      index: true,
    },
    statusMessage: { type: String, default: '' },
    commitSha: { type: String, default: '' },
    commitMessage: { type: String, default: '' },
    pullRequestNumber: { type: Number, default: null },
    pullRequestUrl: { type: String, default: '' },
    model: { type: String, default: '' },
    contextFiles: { type: [String], default: [] },
    appliedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

codeChangeSchema.index({ userId: 1, createdAt: -1 });
codeChangeSchema.index({ repositoryId: 1, status: 1, createdAt: -1 });

export const CodeChange = mongoose.models.CodeChange || mongoose.model('CodeChange', codeChangeSchema);
