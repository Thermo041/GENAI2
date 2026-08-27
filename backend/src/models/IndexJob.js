import mongoose from 'mongoose';

/**
 * Durable job record for background work (full indexing, incremental webhook
 * sync, AI PR review). The worker claims jobs atomically via findOneAndUpdate,
 * so multiple Render instances can run safely without Redis.
 */
const indexJobSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['full_index', 'incremental_sync', 'pr_review'],
      default: 'full_index',
      index: true,
    },
    repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    owner: { type: String, required: true },
    repo: { type: String, required: true },
    branch: { type: String, default: '' },
    commitSha: { type: String, default: '' },

    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
      default: 'queued',
      index: true,
    },
    stage: { type: String, default: 'queued' },
    message: { type: String, default: '' },
    progress: { type: Number, default: 0 },

    totalFiles: { type: Number, default: 0 },
    sourceFiles: { type: Number, default: 0 },
    processedFiles: { type: Number, default: 0 },
    skippedFiles: { type: Number, default: 0 },
    chunksCreated: { type: Number, default: 0 },
    embeddingsGenerated: { type: Number, default: 0 },
    symbolsExtracted: { type: Number, default: 0 },
    edgesExtracted: { type: Number, default: 0 },

    // Payload for non-index jobs (webhook sync file lists, PR numbers, ...)
    payload: { type: mongoose.Schema.Types.Mixed, default: undefined },

    issues: {
      type: [
        new mongoose.Schema(
          { filePath: { type: String, default: '' }, message: { type: String, default: '' }, at: { type: Date, default: Date.now } },
          { _id: false },
        ),
      ],
      default: [],
    },

    attempts: { type: Number, default: 0 },
    lockedBy: { type: String, default: '' },
    heartbeatAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

indexJobSchema.index({ repositoryId: 1, status: 1, createdAt: -1 });
indexJobSchema.index({ status: 1, kind: 1, createdAt: 1 });

export const IndexJob = mongoose.models.IndexJob || mongoose.model('IndexJob', indexJobSchema);
