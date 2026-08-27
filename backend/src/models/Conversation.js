import mongoose from 'mongoose';

const citationSchema = new mongoose.Schema(
  {
    filePath: { type: String, required: true },
    startLine: { type: Number, default: 0 },
    endLine: { type: Number, default: 0 },
    symbolName: { type: String, default: '' },
    score: { type: Number, default: 0 },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    citations: { type: [citationSchema], default: [] },
    model: { type: String, default: '' },
    usage: { type: mongoose.Schema.Types.Mixed, default: undefined },
    contextChunks: { type: Number, default: 0 },
    commitSha: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

/** One conversation per (user, repository) thread. */
const conversationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true },
    title: { type: String, default: 'New conversation' },
    messages: { type: [messageSchema], default: [] },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

conversationSchema.index({ userId: 1, repositoryId: 1, updatedAt: -1 });

export const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
