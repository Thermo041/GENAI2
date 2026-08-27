import mongoose from 'mongoose';

const findingSchema = new mongoose.Schema(
  {
    severity: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW'], default: 'MEDIUM' },
    confidence: {
      type: String,
      enum: ['CONFIRMED', 'LIKELY', 'POSSIBLE', 'INSUFFICIENT_CONTEXT'],
      default: 'POSSIBLE',
    },
    category: { type: String, default: 'correctness' },
    filePath: { type: String, default: '' },
    line: { type: Number, default: 0 },
    title: { type: String, default: '' },
    issue: { type: String, default: '' },
    recommendation: { type: String, default: '' },
  },
  { _id: false },
);

/** Stored AI review of a real GitHub pull request. */
const pullRequestReviewSchema = new mongoose.Schema(
  {
    repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    owner: { type: String, required: true },
    repo: { type: String, required: true },
    number: { type: Number, required: true },
    headSha: { type: String, default: '' },
    title: { type: String, default: '' },
    author: { type: String, default: '' },
    state: { type: String, default: '' },

    verdict: { type: String, enum: ['approve', 'comment', 'request_changes'], default: 'comment' },
    summary: { type: String, default: '' },
    riskLevel: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW'], default: 'LOW' },
    findings: { type: [findingSchema], default: [] },
    testGaps: { type: [String], default: [] },
    breakingChanges: { type: [String], default: [] },

    filesReviewed: { type: Number, default: 0 },
    additions: { type: Number, default: 0 },
    deletions: { type: Number, default: 0 },
    contextFiles: { type: [String], default: [] },
    model: { type: String, default: '' },
    trigger: { type: String, enum: ['manual', 'webhook'], default: 'manual' },
    postedToGithub: { type: Boolean, default: false },
    githubCommentUrl: { type: String, default: '' },
  },
  { timestamps: true },
);

pullRequestReviewSchema.index({ owner: 1, repo: 1, number: 1, headSha: 1 }, { unique: true });
pullRequestReviewSchema.index({ repositoryId: 1, createdAt: -1 });

export const PullRequestReview =
  mongoose.models.PullRequestReview || mongoose.model('PullRequestReview', pullRequestReviewSchema);
